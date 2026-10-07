export interface ChargeRequest {
  /** = donation.id (UUID, bukan auto-increment). */
  orderId: string;
  amount: number;
}

export interface ChargeResult {
  externalId: string | null;
  method: string;
  qrString: string | null;
  paymentUrl: string | null;
  expiresAt: Date;
}

export type GatewayStatus = 'SETTLED' | 'FAILED' | 'EXPIRED' | 'PENDING';

export interface GatewayEvent {
  orderId: string;
  externalId: string | null;
  status: GatewayStatus;
  /** Nominal menurut gateway — divalidasi terhadap DB, tidak dipercaya mentah. */
  amount: number;
  method: string;
  raw: unknown;
}

export interface WebhookInput {
  rawBody: Buffer | undefined;
  headers: Record<string, string | string[] | undefined>;
  body: unknown;
}

/** Adapter pattern: ganti provider lewat env PAYMENT_PROVIDER tanpa mengubah PaymentsService. */
export interface PaymentGateway {
  readonly name: string;
  createCharge(req: ChargeRequest): Promise<ChargeResult>;
  /** Verifikasi keaslian webhook; lempar PAYMENT_SIGNATURE_INVALID bila palsu. */
  verifyWebhook(input: WebhookInput): Promise<GatewayEvent>;
  /** Fallback polling bila webhook tidak datang. */
  fetchStatus?(orderId: string, amount: number): Promise<GatewayEvent | null>;
  /** Batalkan charge PENDING di sisi gateway (dipanggil saat expire). Best-effort. */
  cancelCharge?(orderId: string, amount: number): Promise<void>;
}

export const PAYMENT_GATEWAY = Symbol('PAYMENT_GATEWAY');
