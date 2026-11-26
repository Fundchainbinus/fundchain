import { createHmac } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectPaymentGateway } from './app.module';
import {
  SakurupiahAdapter,
  sakurupiahCallbackSignature,
  sakurupiahCreateSignature,
} from './modules/payments/adapters/sakurupiah.adapter';

const ENV = {
  SAKURUPIAH_API_ID: 'SANBOX-90976113',
  SAKURUPIAH_API_KEY: 'SANBOX-key-test',
  SAKURUPIAH_CALLBACK_URL: 'https://api.example.test/api/v1/webhooks/payment',
  SAKURUPIAH_PHONE: '081234567890',
  WEB_URL: 'https://web.example.test',
};

describe('signature Sakurupiah', () => {
  it('create = HMAC-SHA256(api_id + method + merchant_ref + amount, api_key) hex (rumus dokumentasi)', () => {
    const expected = createHmac('sha256', 'k').update('SANBOX-1QRISref-120000').digest('hex');
    expect(sakurupiahCreateSignature('SANBOX-1', 'QRIS', 'ref-1', 20_000, 'k')).toBe(expected);
  });

  it('callback = HMAC-SHA256(raw body, api_key) hex', () => {
    const raw = '{"trx_id":"T1","merchant_ref":"o1","status":"berhasil","status_kode":1}';
    expect(sakurupiahCallbackSignature(raw, 'k')).toBe(createHmac('sha256', 'k').update(raw).digest('hex'));
  });
});

describe('SakurupiahAdapter (fetch di-stub)', () => {
  const adapter = new SakurupiahAdapter();
  const fetchMock = vi.fn();

  beforeEach(() => {
    for (const [k, v] of Object.entries(ENV)) vi.stubEnv(k, v);
    vi.stubGlobal('fetch', fetchMock);
    fetchMock.mockReset();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  const respond = (body: unknown, status = 200) =>
    fetchMock.mockResolvedValueOnce({ ok: status < 400, status, text: async () => JSON.stringify(body) });
  const callback = (body: object, opts: { key?: string; event?: string; signature?: string } = {}) => {
    const raw = Buffer.from(JSON.stringify(body));
    return {
      rawBody: raw,
      body,
      headers: {
        'x-callback-signature': opts.signature ?? sakurupiahCallbackSignature(raw, opts.key ?? ENV.SAKURUPIAH_API_KEY),
        'x-callback-event': opts.event ?? 'payment_status',
      },
    };
  };

  it('createCharge: form-urlencoded + Bearer, signature benar, QR & trx_id dari respons', async () => {
    respond({
      status: '200',
      message: 'success',
      data: [{ trx_id: 'TRX-1', merchant_ref: 'o1', qr: '000201QRIS', checkout_url: 'https://sakurupiah.id/c/TRX-1', expired: '2099-01-01 00:00:00', payment_status: 'pending' }],
    });
    const r = await adapter.createCharge({ orderId: 'o1', amount: 25_000 });
    expect(r).toMatchObject({ externalId: 'TRX-1', method: 'QRIS', qrString: '000201QRIS', paymentUrl: 'https://sakurupiah.id/c/TRX-1' });
    // Batas 15 menit FundChain lebih pendek dari expired gateway → dipakai yang lebih pendek.
    expect(r.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000 + 1000);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://sakurupiah.id/api-sanbox/create.php');
    expect(init.headers.Authorization).toBe(`Bearer ${ENV.SAKURUPIAH_API_KEY}`);
    const form = new URLSearchParams(init.body);
    expect(form.get('merchant_ref')).toBe('o1');
    expect(form.get('amount')).toBe('25000');
    expect(form.get('callback_url')).toBe(ENV.SAKURUPIAH_CALLBACK_URL);
    expect(form.get('return_url')).toBe('https://web.example.test/donations/o1');
    expect(form.get('signature')).toBe(sakurupiahCreateSignature(ENV.SAKURUPIAH_API_ID, 'QRIS', 'o1', 25_000, ENV.SAKURUPIAH_API_KEY));
    expect(form.getAll('harga[]')).toEqual(['25000']);
  });

  it('SAKURUPIAH_SANDBOX=false → endpoint production', async () => {
    vi.stubEnv('SAKURUPIAH_SANDBOX', 'false');
    respond({ status: '200', data: [{ trx_id: 'T', qr: 'Q' }] });
    await adapter.createCharge({ orderId: 'o1', amount: 10_000 });
    expect(fetchMock.mock.calls[0][0]).toBe('https://sakurupiah.id/api/create.php');
  });

  it('createCharge gagal tidak membocorkan api key', async () => {
    respond({ status: '400', message: 'signature salah' }, 400);
    await expect(adapter.createCharge({ orderId: 'o1', amount: 10_000 })).rejects.toMatchObject({ code: 'PAYMENT_PROVIDER_ERROR' });
    respond({ status: '400', message: 'x' }, 400);
    await expect(adapter.createCharge({ orderId: 'o1', amount: 10_000 })).rejects.not.toThrow(/SANBOX-key-test/);
  });

  it('konfigurasi belum lengkap → PAYMENT_PROVIDER_ERROR yang menyebut env yang kurang', async () => {
    vi.stubEnv('SAKURUPIAH_PHONE', '');
    await expect(adapter.createCharge({ orderId: 'o1', amount: 10_000 })).rejects.toThrow(/SAKURUPIAH_PHONE/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('callback berhasil: signature valid → nominal dikonfirmasi ke status-transaction', async () => {
    respond({ status: '200', data: [{ trx_id: 'TRX-1', merchant_ref: 'o1', payment_status: 'berhasil', total: 25_000 }] });
    const ev = await adapter.verifyWebhook(callback({ trx_id: 'TRX-1', merchant_ref: 'o1', status: 'berhasil', status_kode: 1 }));
    expect(ev).toMatchObject({ orderId: 'o1', externalId: 'TRX-1', status: 'SETTLED', amount: 25_000 });
    expect(fetchMock.mock.calls[0][0]).toContain('/status-transaction.php');
    expect(new URLSearchParams(fetchMock.mock.calls[0][1].body).get('trx_id')).toBe('TRX-1');
  });

  it('callback "berhasil" tapi gateway bilang masih pending → bukan SETTLED', async () => {
    respond({ status: '200', data: [{ trx_id: 'TRX-1', merchant_ref: 'o1', payment_status: 'pending', total: 25_000 }] });
    const ev = await adapter.verifyWebhook(callback({ trx_id: 'TRX-1', merchant_ref: 'o1', status: 'berhasil', status_kode: 1 }));
    expect(ev.status).toBe('PENDING');
  });

  it('callback expired dipetakan tanpa memanggil gateway', async () => {
    const ev = await adapter.verifyWebhook(callback({ trx_id: 'TRX-1', merchant_ref: 'o1', status: 'expired', status_kode: 2 }));
    expect(ev).toMatchObject({ status: 'EXPIRED', orderId: 'o1' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('menolak signature salah, kunci lain, body diubah, dan tanpa header', async () => {
    const body = { trx_id: 'TRX-1', merchant_ref: 'o1', status: 'berhasil', status_kode: 1 };
    await expect(adapter.verifyWebhook(callback(body, { key: 'kunci-lain' }))).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
    await expect(adapter.verifyWebhook(callback(body, { signature: 'f0457a66e085c20c8c8a554d1aebb8' }))).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
    const signed = callback(body);
    const tampered = { ...signed, rawBody: Buffer.from(signed.rawBody.toString().replace('o1', 'o2')) };
    await expect(adapter.verifyWebhook(tampered)).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
    await expect(adapter.verifyWebhook({ ...signed, headers: {} })).rejects.toMatchObject({ code: 'PAYMENT_SIGNATURE_INVALID' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('menolak event selain payment_status', async () => {
    await expect(adapter.verifyWebhook(callback({ trx_id: 'T', merchant_ref: 'o1', status: 'berhasil' }, { event: 'refund' }))).rejects.toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('status-transaction untuk order lain → tidak dikonfirmasi', async () => {
    respond({ status: '200', data: [{ trx_id: 'TRX-1', merchant_ref: 'order-lain', payment_status: 'berhasil', total: 25_000 }] });
    await expect(adapter.verifyWebhook(callback({ trx_id: 'TRX-1', merchant_ref: 'o1', status: 'berhasil' }))).rejects.toMatchObject({
      code: 'PAYMENT_SIGNATURE_INVALID',
    });
  });

  it('fee ditanggung donatur → nominal dibandingkan dari amount, bukan total+fee', async () => {
    vi.stubEnv('SAKURUPIAH_FEE_BY', 'customer');
    respond({ status: '200', data: [{ trx_id: 'TRX-1', merchant_ref: 'o1', payment_status: 'berhasil', total: 25_175, amount: 25_000 }] });
    expect((await adapter.fetchStatus('o1', 25_000, 'TRX-1'))?.amount).toBe(25_000);
  });

  it('PAYMENT_PROVIDER=sakurupiah memilih adapter ini', () => {
    expect(selectPaymentGateway('sakurupiah')).toBeInstanceOf(SakurupiahAdapter);
  });
});
