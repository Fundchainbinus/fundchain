import { Logger } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { AppError } from '../../../common/app-error';
import { env } from '../../../common/env';
import { ChargeRequest, ChargeResult, GatewayEvent, PaymentGateway, WebhookInput } from './payment-gateway';

interface PakasirTransaction {
  amount: number;
  order_id: string;
  project: string;
  status: string;
  payment_method?: string;
  completed_at?: string;
}

/**
 * Adapter Pakasir (QRIS).
 *
 * Endpoint mengikuti dokumentasi publik Pakasir:
 *   POST {base}/api/transactioncreate/qris   { project, order_id, amount, api_key }
 *   GET  {base}/api/transactiondetail?project&amount&order_id&api_key
 *   Webhook body: { amount, order_id, project, status: "completed", payment_method, completed_at }
 *
 * Webhook Pakasir tidak membawa signature, maka keaslian diverifikasi dengan
 * mengonfirmasi ulang ke API transactiondetail (server-to-server, pakai api_key).
 * Cocokkan lagi dengan dokumentasi Pakasir terbaru sebelum dipakai produksi.
 */
export class PakasirAdapter implements PaymentGateway {
  readonly name = 'pakasir';
  private readonly logger = new Logger('Pakasir');

  private get cfg() {
    const cfg = env().pakasir;
    if (!cfg.project || !cfg.apiKey) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'PAKASIR_PROJECT / PAKASIR_API_KEY belum diisi.');
    }
    return cfg;
  }

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    const { baseUrl, project, apiKey } = this.cfg;
    const res = await this.request(`${baseUrl}/api/transactioncreate/qris`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, order_id: req.orderId, amount: req.amount, api_key: apiKey }),
    });
    const payment = (res as { payment?: Record<string, unknown> }).payment;
    if (!payment?.payment_number) {
      throw new AppError('PAYMENT_PROVIDER_ERROR', 'Respons Pakasir tidak berisi QR pembayaran.');
    }
    return {
      externalId: null,
      method: 'QRIS',
      qrString: String(payment.payment_number),
      paymentUrl: `${baseUrl}/pay/${encodeURIComponent(project)}/${req.amount}?order_id=${encodeURIComponent(req.orderId)}&qris_only=1`,
      expiresAt: payment.expired_at
        ? new Date(String(payment.expired_at))
        : new Date(Date.now() + LIMITS.PAYMENT_EXPIRY_MINUTES * 60_000),
    };
  }

  async verifyWebhook(input: WebhookInput): Promise<GatewayEvent> {
    const body = input.body as Partial<PakasirTransaction>;
    if (!body || typeof body.order_id !== 'string' || body.project !== this.cfg.project) {
      throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Webhook Pakasir tidak valid.');
    }
    // Jangan percaya isi webhook: konfirmasi langsung ke Pakasir.
    const confirmed = await this.fetchStatus(body.order_id, Number(body.amount));
    if (!confirmed) throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Transaksi tidak dikonfirmasi oleh Pakasir.');
    return confirmed;
  }

  async fetchStatus(orderId: string, amount: number): Promise<GatewayEvent | null> {
    const { baseUrl, project, apiKey } = this.cfg;
    const qs = new URLSearchParams({ project, amount: String(amount), order_id: orderId, api_key: apiKey });
    const res = (await this.request(`${baseUrl}/api/transactiondetail?${qs}`, { method: 'GET' }).catch(() => null)) as {
      transaction?: PakasirTransaction;
    } | null;
    const trx = res?.transaction;
    if (!trx || trx.order_id !== orderId) return null;
    const status = String(trx.status).toLowerCase();
    return {
      orderId,
      externalId: `PAKASIR-${trx.order_id}`,
      status: status === 'completed' ? 'SETTLED' : status === 'expired' ? 'EXPIRED' : status === 'canceled' || status === 'failed' ? 'FAILED' : 'PENDING',
      amount: Number(trx.amount),
      method: String(trx.payment_method ?? 'qris').toUpperCase(),
      raw: trx,
    };
  }

  /** POST {base}/api/transactioncancel { project, order_id, amount, api_key } — QR lama tidak bisa dibayar lagi. */
  async cancelCharge(orderId: string, amount: number): Promise<void> {
    const { baseUrl, project, apiKey } = this.cfg;
    await this.request(`${baseUrl}/api/transactioncancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, order_id: orderId, amount, api_key: apiKey }),
    });
  }

  private async request(url: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const text = await res.text();
      if (!res.ok) {
        this.logger.warn(`Pakasir ${res.status}: ${text.slice(0, 200)}`);
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
