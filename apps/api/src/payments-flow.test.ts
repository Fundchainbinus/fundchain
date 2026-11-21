/**
 * BFD-20/21/22 — alur pembayaran PaymentsService dengan Prisma palsu in-memory + gateway mock:
 * webhook settle PENDING → PAID, idempotency webhook ganda, validasi nominal, dan expireStale.
 */
import { describe, expect, it, vi } from 'vitest';
import type { GatewayEvent, PaymentGateway } from './modules/payments/adapters/payment-gateway';
import { PaymentsService } from './modules/payments/payments.service';

type Row = Record<string, any>;

/** Cocokkan `where` Prisma sederhana: nilai langsung, { not }, { notIn }, { in }, { lt }. */
function matches(row: Row, where: Row = {}) {
  return Object.entries(where).every(([k, cond]) => {
    const v = row[k];
    if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('not' in cond && v === cond.not) return false;
      if ('notIn' in cond && cond.notIn.includes(v)) return false;
      if ('in' in cond && !cond.in.includes(v)) return false;
      if ('lt' in cond && !(v instanceof Date && v < cond.lt)) return false;
      return true;
    }
    return v === cond;
  });
}

interface SeedPayment {
  donationId: string;
  amount: number;
  status?: string;
  donationStatus?: string;
  expiresAt?: Date;
}

function fakeDb(seed: SeedPayment[]) {
  const state = {
    campaign: { id: 'c1', currentAmount: 0 },
    donations: new Map<string, Row>(),
    payments: new Map<string, Row>(),
    outbox: [] as Row[],
    audit: [] as Row[],
  };
  for (const s of seed) {
    state.donations.set(s.donationId, {
      id: s.donationId,
      campaignId: 'c1',
      amount: s.amount,
      status: s.donationStatus ?? 'PENDING',
      hash: null as string | null,
      canonicalPayload: null as string | null,
      donor: { integritySubjectId: 'STU-00001' },
    });
    state.payments.set(s.donationId, {
      id: `p-${s.donationId}`,
      donationId: s.donationId,
      amount: s.amount,
      status: s.status ?? 'PENDING',
      method: 'QRIS',
      externalPaymentId: null,
      paidAt: null,
      expiresAt: s.expiresAt ?? new Date(Date.now() + 15 * 60_000),
    });
  }

  const tx = {
    payment: {
      updateMany: vi.fn(async ({ where, data }: any) => {
        const p = [...state.payments.values()].find((row) => matches(row, where));
        if (!p) return { count: 0 };
        Object.assign(p, data);
        return { count: 1 };
      }),
    },
    donation: {
      update: vi.fn(async ({ where, data }: any) => Object.assign(state.donations.get(where.id)!, data)),
    },
    campaign: {
      update: vi.fn(async ({ data }: any) => {
        state.campaign.currentAmount += data.currentAmount.increment;
      }),
    },
    blockchainTransaction: {
      create: vi.fn(async ({ data }: any) => {
        // Sama dengan constraint unik donation_id di DB.
        if (state.outbox.some((o) => o.donationId === data.donationId)) throw new Error('Unique constraint failed on donation_id');
        state.outbox.push(data);
        return data;
      }),
    },
  };

  const prisma = {
    payment: {
      findUnique: vi.fn(async ({ where }: any) => {
        const p = state.payments.get(where.donationId);
        return p ? { ...p, donation: { ...state.donations.get(p.donationId)! } } : null;
      }),
      findMany: vi.fn(async ({ where }: any) =>
        [...state.payments.values()]
          .filter((p) => matches(p, where))
          .map((p) => ({ donationId: p.donationId, amount: p.amount })),
      ),
    },
    $transaction: async (fn: any) => {
      // Rollback sederhana bila fn melempar (seperti transaksi DB).
      const snap = structuredClone({
        campaign: state.campaign,
        donations: [...state.donations],
        payments: [...state.payments],
        outbox: state.outbox,
        audit: state.audit,
      });
      try {
        return await fn(tx);
      } catch (e) {
        state.campaign = snap.campaign;
        state.donations = new Map(snap.donations);
        state.payments = new Map(snap.payments);
        state.outbox = snap.outbox;
        state.audit = snap.audit;
        throw e;
      }
    },
  };
  const audit = { log: vi.fn(async (entry: Row) => void state.audit.push(entry)) };
  const blockchain = { target: () => ({ network: 'localhost', chainId: 31337, contractAddress: null }) };
  return { state, prisma, tx, audit, blockchain };
}

function setup(seed: SeedPayment[], gateway: Partial<PaymentGateway> = {}) {
  const db = fakeDb(seed);
  const gw = { name: 'mock', ...gateway } as PaymentGateway;
  const service = new PaymentsService(db.prisma as any, db.audit as any, db.blockchain as any, gw);
  return { ...db, service, gateway: gw };
}

const settled = (orderId: string, amount: number, extra: Partial<GatewayEvent> = {}): GatewayEvent => ({
  orderId,
  externalId: `EXT-${orderId}`,
  status: 'SETTLED',
  amount,
  method: 'QRIS',
  raw: null,
  ...extra,
});

const actions = (audit: Row[]) => audit.map((a) => a.action);

describe('PaymentsService.handleWebhook / applyEvent — settle', () => {
  it('PENDING → PAID: payment SETTLED, donasi PAID + hash, saldo naik, outbox QUEUED, audit tercatat', async () => {
    const { service, state } = setup([{ donationId: 'd1', amount: 50_000 }], {
      verifyWebhook: async () => settled('d1', 50_000),
    });

    const out = await service.handleWebhook({ rawBody: undefined, headers: {}, body: {} }, '1.2.3.4');

    expect(out).toEqual({ received: true, replayed: false, donationId: 'd1', status: 'PAID' });
    const payment = state.payments.get('d1')!;
    expect(payment).toMatchObject({ status: 'SETTLED', externalPaymentId: 'EXT-d1', method: 'QRIS' });
    expect(payment.paidAt).toBeInstanceOf(Date);
    const donation = state.donations.get('d1')!;
    expect(donation.status).toBe('PAID');
    expect(donation.integrityStatus).toBe('PENDING');
    expect(donation.hash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(donation.canonicalPayload).toContain('|50000|');
    expect(state.campaign.currentAmount).toBe(50_000);
    expect(state.outbox).toHaveLength(1);
    expect(state.outbox[0]).toMatchObject({ donationId: 'd1', status: 'QUEUED', chainId: 31337 });
    expect(actions(state.audit)).toEqual(['PAYMENT_WEBHOOK_RECEIVED', 'DONATION_PAID']);
    expect(state.audit[1]).toMatchObject({ entityId: 'd1', metadata: { amount: 50_000, hash: donation.hash } });
  });

  it('webhook dengan signature tidak valid: dicatat PAYMENT_WEBHOOK_REJECTED, tidak ada perubahan', async () => {
    const err = Object.assign(new Error('Signature webhook tidak valid.'), { code: 'PAYMENT_SIGNATURE_INVALID' });
    const { service, state } = setup([{ donationId: 'd1', amount: 50_000 }], {
      verifyWebhook: async () => {
        throw err;
      },
    });
    await expect(service.handleWebhook({ rawBody: undefined, headers: {}, body: {} }, null)).rejects.toBe(err);
    expect(actions(state.audit)).toEqual(['PAYMENT_WEBHOOK_REJECTED']);
    expect(state.donations.get('d1')!.status).toBe('PENDING');
  });

  it('order tidak dikenal → PAYMENT_NOT_FOUND', async () => {
    const { service } = setup([]);
    await expect(service.applyEvent(settled('nope', 1_000))).rejects.toMatchObject({ code: 'PAYMENT_NOT_FOUND' });
  });

  it('event PENDING tidak mengubah apa pun', async () => {
    const { service, state, tx } = setup([{ donationId: 'd1', amount: 50_000 }]);
    const out = await service.applyEvent(settled('d1', 50_000, { status: 'PENDING' }));
    expect(out).toMatchObject({ replayed: false, status: 'PENDING' });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(state.payments.get('d1')!.status).toBe('PENDING');
  });
});

describe('PaymentsService — idempotency webhook ganda', () => {
  it('webhook kedua → replayed:true, tidak ada update kedua (saldo & outbox hanya sekali)', async () => {
    const { service, state, tx } = setup([{ donationId: 'd1', amount: 50_000 }]);

    await service.applyEvent(settled('d1', 50_000));
    const hash = state.donations.get('d1')!.hash;
    const second = await service.applyEvent(settled('d1', 50_000));

    expect(second).toEqual({ received: true, replayed: true, donationId: 'd1', status: 'PAID' });
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(1);
    expect(tx.donation.update).toHaveBeenCalledTimes(1);
    expect(tx.campaign.update).toHaveBeenCalledTimes(1);
    expect(state.campaign.currentAmount).toBe(50_000);
    expect(state.outbox).toHaveLength(1);
    expect(state.donations.get('d1')!.hash).toBe(hash);
    expect(actions(state.audit).filter((a) => a === 'DONATION_PAID')).toHaveLength(1);
  });

  it('balapan: dua webhook membaca PENDING bersamaan → hanya satu yang settle (guard updateMany)', async () => {
    const { service, state, tx } = setup([{ donationId: 'd1', amount: 50_000 }]);

    const [a, b] = await Promise.all([service.applyEvent(settled('d1', 50_000)), service.applyEvent(settled('d1', 50_000))]);

    expect([a.replayed, b.replayed].sort()).toEqual([false, true]);
    expect(tx.payment.updateMany).toHaveBeenCalledTimes(2);
    expect(tx.donation.update).toHaveBeenCalledTimes(1);
    expect(state.campaign.currentAmount).toBe(50_000);
    expect(state.outbox).toHaveLength(1);
  });

  it('webhook SETTLED yang diputar ulang setelah refund → replayed, donasi tetap REFUNDED', async () => {
    const { service, state, tx } = setup([{ donationId: 'd1', amount: 50_000, status: 'REFUNDED', donationStatus: 'REFUNDED' }]);

    const out = await service.applyEvent(settled('d1', 50_000));

    expect(out).toMatchObject({ replayed: true, status: 'REFUNDED' });
    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(state.payments.get('d1')!.status).toBe('REFUNDED');
    expect(state.donations.get('d1')!.status).toBe('REFUNDED');
    expect(state.campaign.currentAmount).toBe(0);
  });
});

describe('PaymentsService — validasi nominal', () => {
  it('nominal webhook ≠ nominal di DB → PAYMENT_AMOUNT_MISMATCH, tidak ada settle', async () => {
    const { service, state, tx } = setup([{ donationId: 'd1', amount: 50_000 }]);

    await expect(service.applyEvent(settled('d1', 5_000))).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_MISMATCH' });

    expect(tx.payment.updateMany).not.toHaveBeenCalled();
    expect(state.payments.get('d1')!.status).toBe('PENDING');
    expect(state.donations.get('d1')!.status).toBe('PENDING');
    expect(state.campaign.currentAmount).toBe(0);
    expect(state.audit).toEqual([
      expect.objectContaining({ action: 'PAYMENT_AMOUNT_MISMATCH', metadata: expect.objectContaining({ expected: 50_000, received: 5_000 }) }),
    ]);
  });

  it('nominal bukan angka (NaN) juga ditolak', async () => {
    const { service } = setup([{ donationId: 'd1', amount: 50_000 }]);
    await expect(service.applyEvent(settled('d1', Number.NaN))).rejects.toMatchObject({ code: 'PAYMENT_AMOUNT_MISMATCH' });
  });
});

describe('PaymentsService — FAILED/EXPIRED dari gateway', () => {
  it('event EXPIRED: PENDING → EXPIRED + audit; diulang tidak menulis audit kedua', async () => {
    const { service, state } = setup([{ donationId: 'd1', amount: 50_000 }]);
    const ev = settled('d1', 50_000, { status: 'EXPIRED' });

    await expect(service.applyEvent(ev)).resolves.toMatchObject({ status: 'EXPIRED' });
    await service.applyEvent(ev);

    expect(state.payments.get('d1')!.status).toBe('EXPIRED');
    expect(state.donations.get('d1')!.status).toBe('EXPIRED');
    expect(actions(state.audit)).toEqual(['PAYMENT_EXPIRED']);
  });
});

describe('PaymentsService.expireStale', () => {
  const past = () => new Date(Date.now() - 60_000);

  it('PENDING lewat expiresAt → EXPIRED dan cancelCharge dipanggil; yang belum lewat tidak disentuh', async () => {
    const cancelCharge = vi.fn(async () => undefined);
    const fetchStatus = vi.fn(async (orderId: string, amount: number) => settled(orderId, amount, { status: 'PENDING' }));
    const { service, state } = setup(
      [
        { donationId: 'stale', amount: 20_000, expiresAt: past() },
        { donationId: 'fresh', amount: 30_000 },
      ],
      { fetchStatus, cancelCharge },
    );

    await expect(service.expireStale()).resolves.toBe(1);

    expect(fetchStatus).toHaveBeenCalledWith('stale', 20_000);
    expect(state.payments.get('stale')!.status).toBe('EXPIRED');
    expect(state.donations.get('stale')!.status).toBe('EXPIRED');
    expect(cancelCharge).toHaveBeenCalledWith('stale', 20_000);
    expect(state.payments.get('fresh')!.status).toBe('PENDING');
    expect(actions(state.audit)).toEqual(['PAYMENT_EXPIRED']);
  });

  it('gateway tanpa fetchStatus/cancelCharge: tetap di-EXPIRED-kan', async () => {
    const { service, state } = setup([{ donationId: 'stale', amount: 20_000, expiresAt: past() }]);
    await service.expireStale();
    expect(state.donations.get('stale')!.status).toBe('EXPIRED');
  });

  it('gateway bilang sudah dibayar di detik terakhir → di-settle (PAID), bukan EXPIRED, dan tidak di-cancel', async () => {
    const cancelCharge = vi.fn(async () => undefined);
    const { service, state } = setup([{ donationId: 'late', amount: 20_000, expiresAt: past() }], {
      fetchStatus: async (orderId, amount) => settled(orderId, amount),
      cancelCharge,
    });

    await service.expireStale();

    expect(state.payments.get('late')!.status).toBe('SETTLED');
    expect(state.donations.get('late')!.status).toBe('PAID');
    expect(state.campaign.currentAmount).toBe(20_000);
    expect(state.outbox).toHaveLength(1);
    expect(cancelCharge).not.toHaveBeenCalled();
  });

  it('fetchStatus gagal (gateway down) → dianggap EXPIRED; cancelCharge gagal tidak menggagalkan tick', async () => {
    const { service, state } = setup([{ donationId: 'stale', amount: 20_000, expiresAt: past() }], {
      fetchStatus: async () => {
        throw new Error('timeout');
      },
      cancelCharge: async () => {
        throw new Error('gateway 500');
      },
    });
    await expect(service.expireStale()).resolves.toBe(1);
    expect(state.donations.get('stale')!.status).toBe('EXPIRED');
  });
});
