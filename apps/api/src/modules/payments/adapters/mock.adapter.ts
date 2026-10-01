import { LIMITS } from '@fundchain/shared';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { AppError } from '../../../common/app-error';
import { env } from '../../../common/env';
import { ChargeRequest, ChargeResult, GatewayEvent, PaymentGateway, WebhookInput } from './payment-gateway';

export const MOCK_SIGNATURE_HEADER = 'x-fundchain-signature';

export function signMockBody(rawBody: string, secret = env().mockWebhookSecret): string {
  return createHmac('sha256', secret).update(rawBody).digest('hex');
}

export function verifyMockSignature(rawBody: Buffer | string, signature: string | undefined, secret: string): boolean {
  if (!signature || !/^[0-9a-f]{64}$/i.test(signature)) return false;
  const expected = Buffer.from(createHmac('sha256', secret).update(rawBody).digest('hex'), 'hex');
  const given = Buffer.from(signature, 'hex');
  return expected.length === given.length && timingSafeEqual(expected, given);
}

const STATUS_MAP: Record<string, GatewayEvent['status']> = {
  settlement: 'SETTLED',
  completed: 'SETTLED',
  expire: 'EXPIRED',
  failed: 'FAILED',
  cancel: 'FAILED',
  pending: 'PENDING',
};

/**
 * Gateway simulasi untuk development & cadangan demo.
 * Webhook ditandatangani HMAC-SHA256 sama seperti gateway sungguhan, sehingga jalur
 * verifikasi signature → idempotency → validasi amount tetap teruji.
 */
export class MockPaymentAdapter implements PaymentGateway {
  readonly name = 'mock';

  async createCharge(req: ChargeRequest): Promise<ChargeResult> {
    return {
      externalId: `MOCK-${randomUUID()}`,
      method: 'QRIS',
      qrString: `FUNDCHAIN-MOCK-QRIS|${req.orderId}|${req.amount}`,
      paymentUrl: null,
      expiresAt: new Date(Date.now() + LIMITS.PAYMENT_EXPIRY_MINUTES * 60_000),
    };
  }

  async verifyWebhook(input: WebhookInput): Promise<GatewayEvent> {
    const header = input.headers[MOCK_SIGNATURE_HEADER];
    const signature = Array.isArray(header) ? header[0] : header;
    if (!input.rawBody || !verifyMockSignature(input.rawBody, signature, env().mockWebhookSecret)) {
      throw new AppError('PAYMENT_SIGNATURE_INVALID', 'Signature webhook tidak valid.');
    }
    const body = input.body as Record<string, unknown>;
    const status = STATUS_MAP[String(body.status)];
    if (!status || typeof body.order_id !== 'string') {
      throw new AppError('VALIDATION_ERROR', 'Payload webhook tidak dikenali.');
    }
    return {
      orderId: body.order_id,
      externalId: typeof body.transaction_id === 'string' ? body.transaction_id : null,
      status,
      amount: Number(body.amount),
      method: String(body.payment_method ?? 'qris').toUpperCase(),
      raw: body,
    };
  }
}
