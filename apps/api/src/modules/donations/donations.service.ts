import { Injectable, Logger } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { AppError } from '../../common/app-error';
import type { CurrentUserPayload } from '../../common/auth';
import { publicDonorName } from '../../common/format';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentsService } from '../payments/payments.service';

@Injectable()
export class DonationsService {
  private readonly logger = new Logger('Donations');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
    private readonly blockchain: BlockchainService,
  ) {}

  async create(
    campaignId: string,
    input: { amount: number; anonymous?: boolean },
    idempotencyKey: string | undefined,
    user: CurrentUserPayload,
    ip: string | null,
  ) {
    if (!idempotencyKey || !/^[A-Za-z0-9-]{8,100}$/.test(idempotencyKey)) {
      throw new AppError('IDEMPOTENCY_KEY_REQUIRED', 'Header Idempotency-Key wajib diisi.');
    }
    const amount = input.amount;
    if (!Number.isInteger(amount) || amount < LIMITS.DONATION_MIN || amount > LIMITS.DONATION_MAX) {
      throw new AppError('DONATION_AMOUNT_INVALID', 'Nominal donasi antara Rp10.000 dan Rp1.000.000.000.');
    }

    const existing = await this.prisma.donation.findUnique({ where: { idempotencyKey } });
    if (existing) {
      // Request yang sama diulang → kembalikan hasil yang sama; beda isi → konflik.
      if (existing.donorId === user.id && existing.campaignId === campaignId && existing.amount === amount) {
        return this.detail(existing.id, user);
      }
      throw new AppError('DONATION_DUPLICATE', 'Idempotency-Key sudah dipakai untuk donasi lain.');
    }

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    if (campaign.status !== 'ACTIVE' || campaign.deadline <= new Date()) {
      throw new AppError('CAMPAIGN_NOT_ACTIVE', 'Campaign tidak sedang menerima donasi.');
    }

    const donation = await this.prisma.$transaction(async (tx) => {
      const created = await tx.donation.create({
        data: {
          campaignId,
          donorId: user.id,
          amount,
          isAnonymous: Boolean(input.anonymous),
          idempotencyKey,
          status: 'PENDING',
        },
      });
      await tx.payment.create({
        data: { donationId: created.id, provider: this.payments.gateway.name, amount, status: 'PENDING' },
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: 'DONATION_CREATED',
          entityType: 'Donation',
          entityId: created.id,
          metadata: { campaignId, amount, provider: this.payments.gateway.name },
          ipAddress: ip,
        },
        tx,
      );
      return created;
    });

    try {
      const charge = await this.payments.gateway.createCharge({ orderId: donation.id, amount });
      await this.prisma.payment.update({
        where: { donationId: donation.id },
        data: {
          externalPaymentId: charge.externalId,
          method: charge.method,
          qrString: charge.qrString,
          paymentUrl: charge.paymentUrl,
          expiresAt: charge.expiresAt,
        },
      });
    } catch (e) {
      this.logger.warn(`createCharge gagal untuk ${donation.id}: ${(e as Error).message}`);
      await this.prisma.$transaction([
        this.prisma.payment.update({ where: { donationId: donation.id }, data: { status: 'FAILED' } }),
        this.prisma.donation.update({ where: { id: donation.id }, data: { status: 'FAILED' } }),
      ]);
      throw e instanceof AppError ? e : new AppError('PAYMENT_PROVIDER_ERROR', 'Gagal membuat pembayaran.');
    }

    return this.detail(donation.id, user);
  }

  /**
   * Detail + bukti donasi. Publik (halaman transparansi), tetapi data pembayaran
   * (QR) hanya untuk donor & admin, dan identitas donor dipseudonimkan.
   */
  async detail(id: string, viewer?: CurrentUserPayload) {
    let donation = await this.load(id);
    const isDonor = viewer?.id === donation.donorId;
    const isAdmin = viewer?.role === 'ADMIN';

    if (donation.status === 'PENDING' && (isDonor || isAdmin)) {
      await this.payments.syncPending(id);
      if (donation.payment?.expiresAt && donation.payment.expiresAt < new Date()) await this.payments.expireStale();
      donation = await this.load(id);
    }
    if (donation.status !== 'PAID' && !isDonor && !isAdmin) {
      throw new AppError('DONATION_NOT_FOUND', 'Donasi tidak ditemukan.');
    }

    const bc = donation.blockchain;
    return {
      id: donation.id,
      amount: donation.amount,
      status: donation.status,
      isAnonymous: donation.isAnonymous,
      donor: {
        displayName: publicDonorName(donation.donor.name, donation.isAnonymous),
        integritySubjectId: donation.donor.integritySubjectId,
      },
      campaign: donation.campaign,
      donatedAt: donation.donatedAt,
      createdAt: donation.createdAt,
      canonicalPayload: donation.canonicalPayload,
      hash: donation.hash,
      integrityStatus: donation.integrityStatus,
      lastCheckedAt: donation.lastCheckedAt,
      payment: donation.payment
        ? {
            provider: donation.payment.provider,
            method: donation.payment.method,
            status: donation.payment.status,
            amount: donation.payment.amount,
            paidAt: donation.payment.paidAt,
            expiresAt: donation.payment.expiresAt,
            ...(isDonor || isAdmin
              ? { qrString: donation.payment.qrString, paymentUrl: donation.payment.paymentUrl }
              : {}),
          }
        : null,
      blockchain: bc
        ? {
            status: bc.status,
            network: bc.network,
            chainId: bc.chainId,
            contractAddress: bc.contractAddress,
            onchainKey: bc.onchainKey,
            txHash: bc.txHash,
            blockNumber: bc.blockNumber,
            retryCount: bc.retryCount,
            submittedAt: bc.submittedAt,
            confirmedAt: bc.confirmedAt,
            explorerUrl: this.blockchain.explorerTx(bc.chainId, bc.txHash),
            ...(isAdmin ? { lastError: bc.lastError } : {}),
          }
        : null,
      viewer: { isDonor, isAdmin },
    };
  }

  async listForCampaign(campaignId: string, limit = 50) {
    const donations = await this.prisma.donation.findMany({
      where: { campaignId, status: 'PAID' },
      include: { donor: { select: { name: true, integritySubjectId: true } }, blockchain: true },
      orderBy: { donatedAt: 'desc' },
      take: Math.min(limit, 200),
    });
    return donations.map((d) => ({
      id: d.id,
      amount: d.amount,
      donorName: publicDonorName(d.donor.name, d.isAnonymous),
      donatedAt: d.donatedAt,
      hash: d.hash,
      integrityStatus: d.integrityStatus,
      blockchainStatus: d.blockchain?.status ?? null,
      txHash: d.blockchain?.txHash ?? null,
      explorerUrl: d.blockchain ? this.blockchain.explorerTx(d.blockchain.chainId, d.blockchain.txHash) : null,
    }));
  }

  async listMine(user: CurrentUserPayload) {
    const donations = await this.prisma.donation.findMany({
      where: { donorId: user.id },
      include: { campaign: { select: { id: true, title: true, status: true } }, blockchain: true, payment: true },
      orderBy: { createdAt: 'desc' },
    });
    return donations.map((d) => ({
      id: d.id,
      amount: d.amount,
      status: d.status,
      isAnonymous: d.isAnonymous,
      campaign: d.campaign,
      createdAt: d.createdAt,
      donatedAt: d.donatedAt,
      integrityStatus: d.integrityStatus,
      paymentStatus: d.payment?.status ?? null,
      blockchainStatus: d.blockchain?.status ?? null,
      txHash: d.blockchain?.txHash ?? null,
    }));
  }

  /** Daftar donasi untuk admin (integrity checker). */
  async listAll(filter: { campaignId?: string; integrityStatus?: string; status?: string }) {
    const donations = await this.prisma.donation.findMany({
      where: {
        campaignId: filter.campaignId || undefined,
        integrityStatus: filter.integrityStatus || undefined,
        status: filter.status || 'PAID',
      },
      include: {
        campaign: { select: { id: true, title: true, status: true } },
        donor: { select: { name: true, integritySubjectId: true } },
        blockchain: true,
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    return donations.map((d) => ({
      id: d.id,
      amount: d.amount,
      status: d.status,
      donor: d.donor,
      campaign: d.campaign,
      donatedAt: d.donatedAt,
      hash: d.hash,
      integrityStatus: d.integrityStatus,
      lastCheckedAt: d.lastCheckedAt,
      blockchain: d.blockchain
        ? {
            status: d.blockchain.status,
            txHash: d.blockchain.txHash,
            retryCount: d.blockchain.retryCount,
            lastError: d.blockchain.lastError,
            explorerUrl: this.blockchain.explorerTx(d.blockchain.chainId, d.blockchain.txHash),
          }
        : null,
    }));
  }

  private async load(id: string) {
    const donation = await this.prisma.donation.findUnique({
      where: { id },
      include: {
        donor: { select: { name: true, integritySubjectId: true } },
        campaign: { select: { id: true, title: true, status: true } },
        payment: true,
        blockchain: true,
      },
    });
    if (!donation) throw new AppError('DONATION_NOT_FOUND', 'Donasi tidak ditemukan.');
    return donation;
  }
}
