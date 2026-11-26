import { Logger } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/app-error';
import { env } from '../../../common/env';
import { ChargeRequest, ChargeResult, GatewayEvent, GatewayStatus, PaymentGateway, WebhookInput } from './payment-gateway';

/** Satu transaksi di respons create / status-transaction Sakurupiah (field yang dipakai saja). */
interface SakurupiahTrx {
  trx_id?: string;
  merchant_ref?: string;
  payment_status?: string;
  status?: string;
  total?: number | string;
  amount?: number | string;
  amount_merchant?: number | string;
  expired?: string;
  qr?: string;
  checkout_url?: string;
  via?: string;
}

/** Signature create: HMAC-SHA256(api_id + method + merchant_ref + amount, api_key), hex. */
export function sakurupiahCreateSignature(apiId: string, method: string, merchantRef: string, amount: number, apiKey: string) {
  return createHmac('sha256', apiKey).update(`${apiId}${method}${merchantRef}${amount}`).digest('hex');
}

/** Signature callback: HMAC-SHA256(raw JSON body, api_key), hex — dikirim di header X-Callback-Signature. */
export function sakurupiahCallbackSignature(rawBody: Buffer | string, apiKey: string) {
  return createHmac('sha256', apiKey).update(rawBody).digest('hex');
}

function mapStatus(s: string | undefined): GatewayStatus {
  switch ((s ?? '').toLowerCase()) {
    case 'berhasil':
    case 'success':
    case 'paid':
      return 'SETTLED';
    case 'expired':
      return 'EXPIRED';
    case 'gagal':
    case 'failed':
    case 'batal':
    case 'canceled':
      return 'FAILED';
    default:
      return 'PENDING';
  }
}

/** "2026-11-26 15:04:05" di zona Asia/Jakarta (UTC+7, tanpa DST). */
function parseJakarta(s: string | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})$/.exec(s ?? '');
  if (!m) return null;
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}+07:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Adapter Sakurupiah (QRIS) — pengganti Pakasir (D-002, BFD-108 s.d. BFD-111).
 *
 * Mengikuti https://sakurupiah.id/developers/api-dokumentasi (dibaca 26 Nov 2026):
 *   POST {base}/create.php               form: api_id, method, phone, amount, merchant_fee, merchant_ref,
 *                                              expired, produk[], qty[], harga[], callback_url, return_url, signature
 *   POST {base}/status-transaction.php   form: api_id, trx_id
 *   Header semua request: Authorization: Bearer <api_key>
 *   Callback: POST JSON { trx_id, merchant_ref, status: pending|berhasil|expired, status_kode }
 *             + X-Callback-Signature = HMAC-SHA256(raw body, api_key), X-Callback-Event = payment_status
 *   base = https://sakurupiah.id/api (production) atau https://sakurupiah.id/api-sanbox (sandbox).
 *
 * Callback tidak membawa nominal, jadi status SETTLED dikonfirmasi ulang ke status-transaction
 * untuk mengambil nominal yang dibandingkan dengan DB (BR-DON-002).
 * BELUM diuji ke sandbox Sakurupiah (butuh akun merchant): cek ulang nama field respons status.
 */
export class SakurupiahAdapter implements PaymentGateway {
  readonly name = 'sakurupiah';
  private readonly logger = new Logger('Sakurupiah');

  private get cfg() {
    const cfg = env().sakurupiah;
    if (!cfg.apiId || !cfg.apiKey) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'SAKURUPIAH_API_ID / SAKURUPIAH_API_KEY belum diisi.');
    }
    if (!cfg.callbackUrl) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'SAKURUPIAH_CALLBACK_URL belum diisi (URL publik POST /api/v1/webhooks/payment).');
    }
    if (!cfg.phone) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'SAKURUPIAH_PHONE belum diisi (nomor wajib di request Sakurupiah).');
    }
    return cfg;
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const c = this.cfg;
    const form = new URLSearchParams({
      api_id: c.apiId,
      method: c.method,
      // Nomor penanggung jawab merchant, bukan nomor donatur: FundChain tidak menyimpan nomor HP donatur.
      phone: c.phone,
      amount: String(req.amount),
      merchant_fee: c.feeBy === 'customer' ? '2' : '1',
      merchant_ref: req.orderId,
      // Sakurupiah memakai satuan jam (minimal 1). Batas 15 menit FundChain tetap ditegakkan cron (D-005);
      // bayar terlambat sebelum QR kedaluwarsa di gateway tetap diterima applyEvent.
      expired: '1',
      callback_url: c.callbackUrl,
      return_url: `${env().webUrl.replace(/\/$/, '')}/donations/${req.orderId}`,
      signature: sakurupiahCreateSignature(c.apiId, c.method, req.orderId, req.amount, c.apiKey),
    });
    form.append('produk[]', 'Donasi FundChain');
    form.append('qty[]', '1');
    form.append('harga[]', String(req.amount));

    const res = (await this.request('create.php', form)) as { status?: string | number; message?: string; data?: SakurupiahTrx[] };
    const trx = res.data?.[0];
    if (String(res.status) !== '200' || !trx) {
      this.logger.warn(`create gagal: ${String(res.message ?? '').slice(0, 200)}`);
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Sakurupiah menolak pembuatan pembayaran.');
    }
    if (!trx.qr && !trx.checkout_url) throw new AppError('PAYMENT_PROVIDER_ERROR', 'Respons Sakurupiah tidak berisi QR pembayaran.');
    const ours = new Date(Date.now() + LIMITS.PAYMENT_EXPIRY_MINUTES * 60_000);
    const theirs = parseJakarta(trx.expired);
    return {
      externalId: trx.trx_id ?? null,
      method: c.method,
      qrString: trx.qr ?? null,
      paymentUrl: trx.checkout_url ?? null,
      expiresAt: theirs && theirs < ours ? theirs : ours,
    };
  }

  async verifyWebhook(input: WebhookInput): Promise<GatewayEvent> {
    const { apiKey } = this.cfg;
    const header = input.headers['x-callback-signature'];
    const given = Array.isArray(header) ? header[0] : header;
    if (!input.rawBody || !given) throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Callback Sakurupiah tanpa signature.');
    const expected = sakurupiahCallbackSignature(input.rawBody, apiKey);
    const a = Buffer.from(expected, 'hex');
    const b = Buffer.from(String(given).trim().toLowerCase(), 'hex');
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Signature callback Sakurupiah tidak valid.');
    }
    const event = input.headers['x-callback-event'];
    if (event && (Array.isArray(event) ? event[0] : event) !== 'payment_status') {
      throw new AppError('VALIDATION_ERROR', 'Event callback Sakurupiah tidak didukung.');
    }
    const body = input.body as { trx_id?: string; merchant_ref?: string; status?: string };
    if (typeof body?.merchant_ref !== 'string' || typeof body.trx_id !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Callback Sakurupiah tanpa merchant_ref / trx_id.');
    }
    const status = mapStatus(body.status);
    if (status !== 'SETTLED') {
      return { orderId: body.merchant_ref, externalId: body.trx_id, status, amount: NaN, method: this.cfg.method, raw: body };
    }
    // Callback lunas tidak membawa nominal: ambil dari status-transaction (server-to-server).
    const confirmed = await this.statusByTrx(body.trx_id, body.merchant_ref);
    if (!confirmed) throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Transaksi tidak dikonfirmasi oleh Sakurupiah.');
    return confirmed;
  }

  /** Fallback polling: transaksi dicari lewat trx_id yang tersimpan di payment.externalPaymentId. */
  async fetchStatus(orderId: string, _amount: number, externalId?: string | null): Promise<GatewayEvent | null> {
    return this.statusByTrx(externalId ?? undefined, orderId);
  }

  private async statusByTrx(trxId: string | undefined, orderId: string): Promise<GatewayEvent | null> {
    const c = this.cfg;
    const form = new URLSearchParams({ api_id: c.apiId, ...(trxId ? { trx_id: trxId } : { merchant_ref: orderId }) });
    const res = (await this.request('status-transaction.php', form).catch(() => null)) as { data?: SakurupiahTrx[] | SakurupiahTrx } | null;
    const trx = Array.isArray(res?.data) ? res?.data[0] : res?.data;
    if (!trx || (trx.merchant_ref && trx.merchant_ref !== orderId)) return null;
    // merchant_fee=1 → total = nominal donasi. merchant_fee=2 → donatur bayar fee di atasnya; pakai amount (tanpa fee).
    const amount = Number(c.feeBy === 'customer' ? (trx.amount ?? trx.total) : (trx.total ?? trx.amount));
    return {
      orderId,
      externalId: trx.trx_id ?? trxId ?? null,
      status: mapStatus(trx.payment_status ?? trx.status),
      amount,
      method: c.method,
      raw: trx,
    };
  }

  private async request(path: string, form: URLSearchParams): Promise<unknown> {
    const { baseUrl, apiKey } = this.cfg;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(`${baseUrl}/${path}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body: form.toString(),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`Sakurupiah ${path} ${res.status}: ${text.slice(0, 200)}`);
        throw new AppError('PAYMENT_PROVIDER_ERROR', 'Payment gateway menolak permintaan.');
      }
      return JSON.parse(text);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Payment gateway tidak dapat dihubungi.');
    } finally {
      clearTimeout(timer);
    }
  }
}
