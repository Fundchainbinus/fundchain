import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MOCK_SIGNATURE_HEADER, MockPaymentAdapter, signMockBody } from './modules/payments/adapters/mock.adapter';
import { PakasirAdapter } from './modules/payments/adapters/pakasir.adapter';
import { PaymentsService, assertRefundable } from './modules/payments/payments.service';

const code = (c: string) => expect.objectContaining({ code: c });

describe('assertRefundable', () => {
  it('menerima donasi PAID dengan saldo cukup', () => {
    expect(() => assertRefundable('PAID', 50_000, 50_000)).not.toThrow();
  });

  it('menolak status selain PAID', () => {
    for (const s of ['PENDING', 'FAILED', 'EXPIRED', 'REFUNDED']) {
      expect(() => assertRefundable(s, 10_000, 1_000_000)).toThrowError(code('DONATION_NOT_REFUNDABLE'));
    }
  });

  it('menolak bila saldo yang belum terikat pencairan kurang', () => {
    expect(() => assertRefundable('PAID', 50_001, 50_000)).toThrowError(code('REFUND_EXCEEDS_AVAILABLE'));
  });
});

describe('MockPaymentAdapter.verifyWebhook', () => {
  const adapter = new MockPaymentAdapter();
  const make = (payload: object, sign = true) => {
    const rawBody = JSON.stringify(payload);
    return {
      rawBody: Buffer.from(rawBody),
      headers: sign ? { [MOCK_SIGNATURE_HEADER]: signMockBody(rawBody) } : {},
      body: JSON.parse(rawBody),
    };
  };

  it('memetakan settlement -> SETTLED', async () => {
    const ev = await adapter.verifyWebhook(make({ order_id: 'o1', status: 'settlement', amount: 25_000 }));
    expect(ev).toMatchObject({ orderId: 'o1', status: 'SETTLED', amount: 25_000 });
  });

  it('menolak webhook tanpa signature', async () => {
    await expect(adapter.verifyWebhook(make({ order_id: 'o1', status: 'settlement', amount: 1 }, false))).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
  });

  it('menolak body yang diubah setelah ditandatangani', async () => {
    const input = make({ order_id: 'o1', status: 'settlement', amount: 1_000 });
    const tampered = Buffer.from(input.rawBody.toString().replace('1000', '9000'));
    await expect(adapter.verifyWebhook({ ...input, rawBody: tampered })).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
  });

  it('menolak status yang tidak dikenal', async () => {
    await expect(adapter.verifyWebhook(make({ order_id: 'o1', status: 'aneh', amount: 1 }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('PakasirAdapter (fetch di-stub)', () => {
  const adapter = new PakasirAdapter();
  const fetchMock = vi.fn();

  beforeEach(() => {
    process.env.PAKASIR_PROJECT = 'proj-test';
    process.env.PAKASIR_API_KEY = 'key-test';
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.PAKASIR_PROJECT;
    delete process.env.PAKASIR_API_KEY;
  });

  const respond = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const hook = (body: object) => ({ rawBody: undefined, headers: {}, body });

  it('webhook dikonfirmasi ke transactiondetail, bukan dipercaya mentah', async () => {
    respond({ transaction: { order_id: 'o1', amount: 20_000, project: 'proj-test', status: 'completed', payment_method: 'qris' } });
    const ev = await adapter.verifyWebhook(hook({ order_id: 'o1', amount: 20_000, project: 'proj-test', status: 'completed' }));
    expect(ev).toMatchObject({ orderId: 'o1', status: 'SETTLED', amount: 20_000 });
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/transactiondetail');
  });

  it('webhook palsu: gateway bilang masih pending -> tidak SETTLED', async () => {
    respond({ transaction: { order_id: 'o1', amount: 20_000, project: 'proj-test', status: 'pending' } });
    const ev = await adapter.verifyWebhook(hook({ order_id: 'o1', amount: 20_000, project: 'proj-test', status: 'completed' }));
    expect(ev.status).toBe('PENDING');
  });

  it('menolak webhook untuk project lain tanpa memanggil gateway', async () => {
    await expect(adapter.verifyWebhook(hook({ order_id: 'o1', amount: 1, project: 'project-lain' }))).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('menolak webhook bila transaksi tidak ada di Pakasir', async () => {
    respond({}, 404);
    await expect(adapter.verifyWebhook(hook({ order_id: 'o1', amount: 1, project: 'proj-test' }))).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
  });

  it('memetakan expired/canceled dan nominal dari gateway', async () => {
    respond({ transaction: { order_id: 'o1', amount: 5_000, project: 'proj-test', status: 'expired' } });
    expect((await adapter.fetchStatus('o1', 5_000))?.status).toBe('EXPIRED');
    respond({ transaction: { order_id: 'o1', amount: 5_000, project: 'proj-test', status: 'canceled' } });
    expect((await adapter.fetchStatus('o1', 5_000))?.status).toBe('FAILED');
  });

  it('createCharge mengembalikan QR dan tidak membocorkan api_key ke error', async () => {
    respond({ payment: { payment_number: '000201QR', expired_at: '2030-01-01T00:00:00Z' } });
    const r = await adapter.createCharge({ orderId: 'o1', amount: 10_000 });
    expect(r.qrString).toBe('000201QR');
    respond({ error: 'bad' }, 500);
    await expect(adapter.createCharge({ orderId: 'o2', amount: 10_000 })).rejects.not.toThrow(/key-test/);
  });

  it('cancelCharge memanggil transactioncancel', async () => {
    respond({ ok: true });
    await adapter.cancelCharge('o1', 10_000);
    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/transactioncancel');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toMatchObject({ project: 'proj-test', order_id: 'o1', amount: 10_000 });
  });
});

/** Prisma palsu in-memory: cukup untuk menguji alur refund termasuk rollback. */
function fakeDb(opts: { donationStatus?: string; campaignAmount?: number; committed?: number }) {
  const state = {
    donation: { id: 'd1', campaignId: 'c1', amount: 50_000, status: opts.donationStatus ?? 'PAID', hash: '0xabc', canonicalPayload: '{"x":1}' },
    payment: { donationId: 'd1', status: 'SETTLED' },
    campaign: { id: 'c1', currentAmount: opts.campaignAmount ?? 200_000 },
    audit: [] as any[],
  };
  const tx = {
    $queryRaw: async () => [],
    donation: {
      updateMany: async ({ where, data }: any) => {
        if (state.donation.id !== where.id || state.donation.status !== where.status) return { count: 0 };
        Object.assign(state.donation, data);
        return { count: 1 };
      },
    },
    campaign: {
      findUniqueOrThrow: async () => ({ ...state.campaign }),
      update: async ({ data }: any) => {
        state.campaign.currentAmount -= data.currentAmount.decrement;
      },
    },
    disbursement: { aggregate: async () => ({ _sum: { amount: opts.committed ?? 0 } }) },
    payment: {
      updateMany: async ({ data }: any) => {
        Object.assign(state.payment, data);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    donation: {
      findUnique: async () => ({ ...state.donation, payment: { ...state.payment }, blockchain: { status: 'CONFIRMED' } }),
    },
    $transaction: async (fn: any) => {
      const snap = JSON.stringify(state); // rollback bila fn melempar
      try {
        return await fn(tx);
      } catch (e) {
        Object.assign(state, JSON.parse(snap));
        throw e;
      }
    },
  };
  const audit = { log: async (entry: any) => void state.audit.push(entry) };
  const service = new PaymentsService(prisma as any, audit as any, {} as any, { name: 'mock' } as any);
  return { state, service };
}

describe('PaymentsService.refund', () => {
  it('PAID -> REFUNDED, saldo campaign berkurang, hash on-chain TIDAK berubah', async () => {
    const { state, service } = fakeDb({});
    await expect(service.refund('d1', 'Salah transfer', 'admin1', '1.2.3.4')).resolves.toMatchObject({ status: 'REFUNDED' });
    expect(state.donation.status).toBe('REFUNDED');
    expect(state.payment.status).toBe('REFUNDED');
    expect(state.campaign.currentAmount).toBe(150_000);
    expect(state.donation.hash).toBe('0xabc');
    expect(state.donation.canonicalPayload).toBe('{"x":1}');
    expect(state.audit[0]).toMatchObject({ action: 'DONATION_REFUNDED', actorId: 'admin1' });
  });

  it('refund kedua ditolak (tidak mengurangi saldo dua kali)', async () => {
    const { state, service } = fakeDb({});
    await service.refund('d1', 'Salah transfer', 'admin1', null);
    await expect(service.refund('d1', 'Salah transfer', 'admin1', null)).rejects.toMatchObject({ code: 'DONATION_NOT_REFUNDABLE' });
    expect(state.campaign.currentAmount).toBe(150_000);
  });

  it('menolak donasi yang belum PAID', async () => {
    const { service } = fakeDb({ donationStatus: 'PENDING' });
    await expect(service.refund('d1', 'coba saja', 'admin1', null)).rejects.toMatchObject({ code: 'DONATION_NOT_REFUNDABLE' });
  });

  it('menolak bila dana sudah terikat pencairan, dan status di-rollback', async () => {
    const { state, service } = fakeDb({ campaignAmount: 200_000, committed: 180_000 });
    await expect(service.refund('d1', 'Salah transfer', 'admin1', null)).rejects.toMatchObject({ code: 'REFUND_EXCEEDS_AVAILABLE' });
    expect(state.donation.status).toBe('PAID');
    expect(state.campaign.currentAmount).toBe(200_000);
    expect(state.audit).toHaveLength(0);
  });
});
