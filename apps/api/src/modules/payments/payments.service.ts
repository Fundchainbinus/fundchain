import { Inject, Injectable, Logger } from '@nestjs/common';
import { hashDonation, toOnchainKey } from '@fundchain/shared';
import { AppError } from '../../common/app-error';
import { floorToSecond } from '../../common/format';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { GatewayEvent, PAYMENT_GATEWAY, PaymentGateway, WebhookInput } from './adapters/payment-gateway';

/** Status pencairan yang sudah "mengikat" dana campaign (sama dengan COMMITTED di DisbursementsService). */
const COMMITTED_DISBURSEMENT = ['REQUESTED', 'APPROVED', 'PAID'];

/**
 * Aturan refund (manual oleh admin; Pakasir tidak punya API refund):
 *  - hanya donasi PAID yang bisa di-refund (REFUNDED/FAILED/EXPIRED/PENDING ditolak);
 *  - nominal tidak boleh melebihi saldo campaign yang belum terikat pencairan.
 */
export function assertRefundable(status: string, amount: number, available: number) {
  if (status !== 'PAID') {
    throw new AppError('DONATION_NOT_REFUNDABLE', `Donasi berstatus ${status}; hanya donasi PAID yang bisa di-refund.`);
  }
  if (amount > available) {
    throw new AppError(
      'REFUND_EXCEEDS_AVAILABLE',
      'Saldo campaign yang belum dicairkan lebih kecil dari nominal refund. Tolak/selesaikan pencairan terkait dulu.',
      { amount, available },
    );
  }
}

export interface SettlementOutcome {
  received: true;
  replayed: boolean;
  donationId: string;
  status: string;
}

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly blockchain: BlockchainService,
    @Inject(PAYMENT_GATEWAY) readonly gateway: PaymentGateway,
  ) {}

  /** Entry point webhook: verifikasi → idempotency → validasi amount → settle. */
  async handleWebhook(input: WebhookInput, ip: string | null): Promise<SettlementOutcome> {
    let event: GatewayEvent;
    try {
      event = await this.gateway.verifyWebhook(input);
    } catch (e) {
      await this.audit.log({
        action: 'PAYMENT_WEBHOOK_REJECTED',
        entityType: 'Payment',
        metadata: { provider: this.gateway.name, reason: (e as Error).message },
        ipAddress: ip,
      });
      throw e;
    }
    await this.audit.log({
      action: 'PAYMENT_WEBHOOK_RECEIVED',
      entityType: 'Donation',
      entityId: event.orderId,
      metadata: { provider: this.gateway.name, status: event.status, amount: event.amount },
      ipAddress: ip,
    });
    return this.applyEvent(event);
  }

  async applyEvent(event: GatewayEvent): Promise<SettlementOutcome> {
    const payment = await this.prisma.payment.findUnique({
      where: { donationId: event.orderId },
      include: { donation: { include: { donor: true } } },
    });
    if (!payment) throw new AppError('PAYMENT_NOT_FOUND', 'Order tidak dikenal.');
    const donationId = payment.donationId;

    // Idempotency: settlement kedua tidak diproses ulang (BR-DON-004/005).
    if (payment.status === 'SETTLED') {
      return { received: true, replayed: true, donationId, status: 'PAID' };
    }
    if (event.status === 'PENDING') {
      return { received: true, replayed: false, donationId, status: payment.donation.status };
    }

    if (event.status === 'FAILED' || event.status === 'EXPIRED') {
      await this.prisma.$transaction(async (tx) => {
        const { count } = await tx.payment.updateMany({
          where: { id: payment.id, status: 'PENDING' },
          data: { status: event.status },
        });
        if (count === 0) return;
        await tx.donation.update({ where: { id: donationId }, data: { status: event.status } });
        await this.audit.log(
          { action: `PAYMENT_${event.status}`, entityType: 'Donation', entityId: donationId, metadata: { provider: this.gateway.name } },
          tx,
        );
      });
      return { received: true, replayed: false, donationId, status: event.status };
    }

    // SETTLED — amount final berasal dari DB, webhook hanya divalidasi (BR-DON-002).
    if (!Number.isFinite(event.amount) || event.amount !== payment.amount) {
      await this.audit.log({
        action: 'PAYMENT_AMOUNT_MISMATCH',
        entityType: 'Donation',
        entityId: donationId,
        metadata: { expected: payment.amount, received: event.amount, provider: this.gateway.name },
      });
      throw new AppError('PAYMENT_AMOUNT_MISMATCH', 'Nominal pembayaran tidak sesuai.');
    }

    const target = this.blockchain.target();
    const replayed = await this.prisma.$transaction(async (tx) => {
      // Guard atomic: hanya satu proses yang berhasil men-settle.
      const { count } = await tx.payment.updateMany({
        where: { id: payment.id, status: { not: 'SETTLED' } },
        data: {
          status: 'SETTLED',
          paidAt: new Date(),
          externalPaymentId: event.externalId ?? payment.externalPaymentId,
          method: event.method || payment.method,
        },
      });
      if (count === 0) return true;

      const donatedAt = floorToSecond(new Date());
      const { payload, hash } = hashDonation({
        donationId,
        integritySubjectId: payment.donation.donor.integritySubjectId,
        amount: payment.amount,
        donatedAt,
      });

      await tx.donation.update({
        where: { id: donationId },
        data: { status: 'PAID', donatedAt, canonicalPayload: payload, hash, integrityStatus: 'PENDING' },
      });
      await tx.campaign.update({
        where: { id: payment.donation.campaignId },
        data: { currentAmount: { increment: payment.amount } },
      });
      // Outbox: baris QUEUED ini adalah job notarisasi yang diambil worker.
      await tx.blockchainTransaction.create({
        data: {
          donationId,
          network: target.network,
          chainId: target.chainId,
          contractAddress: target.contractAddress,
          onchainKey: toOnchainKey(donationId),
          status: 'QUEUED',
        },
      });
      await this.audit.log(
        {
          action: 'DONATION_PAID',
          entityType: 'Donation',
          entityId: donationId,
          metadata: { amount: payment.amount, campaignId: payment.donation.campaignId, hash, provider: this.gateway.name },
        },
        tx,
      );
      return false;
    });

    if (!replayed) this.logger.log(`Donasi ${donationId} PAID (Rp${payment.amount}) → antre notarisasi`);
    return { received: true, replayed, donationId, status: 'PAID' };
  }

  /** Fallback polling ke gateway untuk donasi yang masih PENDING. */
  async syncPending(donationId: string) {
    if (!this.gateway.fetchStatus) return;
    const payment = await this.prisma.payment.findUnique({ where: { donationId } });
    if (!payment || payment.status !== 'PENDING') return;
    const event = await this.gateway.fetchStatus(donationId, payment.amount).catch(() => null);
    if (event && event.status !== 'PENDING') await this.applyEvent(event).catch(() => undefined);
  }

  /** Tandai pembayaran PENDING yang lewat batas waktu sebagai EXPIRED. */
  async expireStale() {
    const stale = await this.prisma.payment.findMany({
      where: { status: 'PENDING', expiresAt: { lt: new Date() } },
      select: { donationId: true, amount: true },
      orderBy: { expiresAt: 'asc' },
      take: 100, // batasi per tick supaya tidak melewati batas waktu serverless
    });
    for (const p of stale) {
      // Cek terakhir ke gateway supaya pembayaran di detik terakhir tidak hilang.
      const latest = this.gateway.fetchStatus ? await this.gateway.fetchStatus(p.donationId, p.amount).catch(() => null) : null;
      const event: GatewayEvent =
        latest && latest.status === 'SETTLED'
          ? latest
          : { orderId: p.donationId, externalId: null, status: 'EXPIRED', amount: p.amount, method: 'QRIS', raw: null };
      await this.applyEvent(event).catch(() => undefined);
      // Tutup QR di gateway agar tidak bisa dibayar setelah dianggap kedaluwarsa (best-effort).
      if (event.status === 'EXPIRED' && this.gateway.cancelCharge) {
        await this.gateway.cancelCharge(p.donationId, p.amount).catch((e) =>
          this.logger.warn(`cancelCharge ${p.donationId} gagal: ${(e as Error).message}`),
        );
      }
    }
    return stale.length;
  }

  /**
   * Refund manual oleh admin. Dana dikembalikan di luar sistem (Pakasir tidak punya API refund);
   * method ini hanya mencatat status + mengoreksi saldo campaign.
   *
   * PENTING: hash, canonicalPayload, donatedAt, dan baris blockchainTransaction TIDAK diubah.
   * Bukti on-chain permanen; integrity checker hanya memeriksa donasi PAID sehingga donasi
   * REFUNDED tidak akan terdeteksi TAMPERED.
   */
  async refund(donationId: string, reason: string, actorId: string, ip: string | null) {
    const donation = await this.prisma.donation.findUnique({
      where: { id: donationId },
      include: { payment: true, blockchain: { select: { status: true } } },
    });
    if (!donation || !donation.payment) throw new AppError('DONATION_NOT_FOUND', 'Donasi tidak ditemukan.');
    assertRefundable(donation.status, donation.amount, Number.MAX_SAFE_INTEGER); // cek cepat di luar transaksi

    await this.prisma.$transaction(async (tx) => {
      // Guard atomic: hanya satu refund yang bisa menang.
      const { count } = await tx.donation.updateMany({ where: { id: donationId, status: 'PAID' }, data: { status: 'REFUNDED' } });
      if (count === 0) throw new AppError('DONATION_NOT_REFUNDABLE', 'Donasi sudah tidak berstatus PAID (mungkin sudah di-refund).');

      const campaign = await tx.campaign.findUniqueOrThrow({ where: { id: donation.campaignId } });
      const committed = await tx.disbursement.aggregate({
        where: { campaignId: campaign.id, status: { in: COMMITTED_DISBURSEMENT } },
        _sum: { amount: true },
      });
      assertRefundable('PAID', donation.amount, campaign.currentAmount - (committed._sum.amount ?? 0)); // throw = rollback

      await tx.payment.updateMany({ where: { donationId, status: 'SETTLED' }, data: { status: 'REFUNDED' } });
      await tx.campaign.update({ where: { id: campaign.id }, data: { currentAmount: { decrement: donation.amount } } });
      await this.audit.log(
        {
          actorId,
          action: 'DONATION_REFUNDED',
          entityType: 'Donation',
          entityId: donationId,
          metadata: {
            amount: donation.amount,
            campaignId: campaign.id,
            reason,
            hash: donation.hash,
            onchainStatus: donation.blockchain?.status ?? null,
          },
          ipAddress: ip,
        },
        tx,
      );
    });
    this.logger.log(`Donasi ${donationId} REFUNDED (Rp${donation.amount}) oleh admin ${actorId}`);
    return { donationId, status: 'REFUNDED' as const };
  }
}
