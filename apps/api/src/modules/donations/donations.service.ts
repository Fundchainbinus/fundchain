import { Injectable, Logger } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import type { CurrentUserPayload } from '../../common/auth';
import { publicDonorName } from '../../common/format';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentsService } from '../payments/payments.service';
import { computePoints } from './points';

/** Tab "Donasi Saya" → status donasi. FAILED mencakup EXPIRED (sama seperti tampilan web). */
export const MY_DONATION_TABS: Record<string, string[]> = {
  PAID: ['PAID'],
  PENDING: ['PENDING'],
  FAILED: ['FAILED', 'EXPIRED'],
};
export const MY_DONATIONS_DEFAULT = 20;
export const MY_DONATIONS_MAX = 100;
/** Riwayat poin yang dikirim ke web; total tetap dari seluruh donasi PAID. */
export const POINTS_HISTORY_MAX = 50;

export function clampMyDonationsLimit(limit: string | number | undefined): number {
  const n = Number(limit);
  if (limit === undefined || limit === '' || !Number.isFinite(n)) return MY_DONATIONS_DEFAULT;
  return Math.min(MY_DONATIONS_MAX, Math.max(1, Math.trunc(n)));
}

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
    if (existing) return this.replay(existing, campaignId, amount, user);

    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    if (campaign.status !== 'ACTIVE' || campaign.deadline <= new Date()) {
      throw new AppError('CAMPAIGN_NOT_ACTIVE', 'Campaign tidak sedang menerima donasi.');
    }

    let donation: { id: string };
    try {
      donation = await this.createPending(campaignId, amount, Boolean(input.anonymous), idempotencyKey, user, ip);
    } catch (e) {
      // Dua request bersamaan dengan key sama: keduanya lolos pre-check, yang kalah kena unique
      // violation (P2002). Perlakukan seperti replay, bukan 500.
      if (!isUniqueViolation(e, 'idempotencyKey', 'idempotency_key')) throw e;
      const winner = await this.prisma.donation.findUnique({ where: { idempotencyKey } });
      if (!winner) throw e;
      return this.replay(winner, campaignId, amount, user);
    }

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

  /** Request ulang dengan Idempotency-Key yang sama → hasil yang sama; beda isi → konflik. */
  private replay(
    existing: { id: string; donorId: string; campaignId: string; amount: number },
    campaignId: string,
    amount: number,
    user: CurrentUserPayload,
  ) {
    if (existing.donorId === user.id && existing.campaignId === campaignId && existing.amount === amount) {
      return this.detail(existing.id, user);
    }
    throw new AppError('DONATION_DUPLICATE', 'Idempotency-Key sudah dipakai untuk donasi lain.');
  }

  private createPending(
    campaignId: string,
    amount: number,
    anonymous: boolean,
    idempotencyKey: string,
    user: CurrentUserPayload,
    ip: string | null,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const created = await tx.donation.create({
        data: {
          campaignId,
          donorId: user.id,
          amount,
          isAnonymous: anonymous,
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
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId }, select: { deletedAt: true } });
    if (!campaign || campaign.deletedAt) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
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

  /**
   * "Donasi Saya" (BUG-009 / #27): per halaman (cursor, seperti audit log), hanya kolom yang dipakai web.
   * `summary` dihitung di DB supaya jumlah per tab & total lunas tetap benar walau baru satu halaman dimuat.
   */
  async listMine(user: CurrentUserPayload, query: { limit?: string | number; cursor?: string; status?: string } = {}) {
    const limit = clampMyDonationsLimit(query.limit);
    const statuses = query.status ? MY_DONATION_TABS[query.status] : undefined;
    if (query.status && !statuses) throw new AppError('VALIDATION_ERROR', 'Filter status tidak valid.');

    const rows = await this.prisma.donation.findMany({
      where: { donorId: user.id, status: statuses ? { in: statuses } : undefined },
      select: {
        id: true,
        amount: true,
        status: true,
        isAnonymous: true,
        createdAt: true,
        donatedAt: true,
        integrityStatus: true,
        campaign: { select: { id: true, title: true, status: true } },
        payment: { select: { status: true } },
        blockchain: { select: { status: true, txHash: true } },
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);

    const groups = await this.prisma.donation.groupBy({
      by: ['status'],
      where: { donorId: user.id },
      _count: { _all: true },
      _sum: { amount: true },
    });
    const count = (...s: string[]) => groups.filter((g) => s.includes(g.status)).reduce((n, g) => n + g._count._all, 0);

    return {
      donations: page.map((d) => ({
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
      })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
      summary: {
        counts: {
          ALL: groups.reduce((n, g) => n + g._count._all, 0),
          PAID: count('PAID'),
          PENDING: count('PENDING'),
          FAILED: count(...MY_DONATION_TABS.FAILED),
        },
        paidTotal: groups.find((g) => g.status === 'PAID')?._sum.amount ?? 0,
      },
    };
  }

  /**
   * Poin comserve milik donatur yang login (BFD-98). BUG-010 / #28: total & jumlah donasi dihitung di DB
   * (poin per donasi dibulatkan ke bawah, lalu dijumlah — sama dengan computePoints); riwayat dibatasi.
   */
  async pointsMine(user: CurrentUserPayload) {
    const [agg] = await this.prisma.$queryRaw<{ total: bigint | number | null; count: bigint | number }[]>`
      SELECT COALESCE(SUM(FLOOR(amount / ${LIMITS.RUPIAH_PER_POINT}::numeric)), 0)::bigint AS total,
             COUNT(*)::bigint AS count
      FROM donations
      WHERE donor_id = ${user.id} AND status = 'PAID'`;
    const recent = await this.prisma.donation.findMany({
      where: { donorId: user.id, status: 'PAID' },
      select: {
        id: true,
        amount: true,
        status: true,
        donatedAt: true,
        createdAt: true,
        campaign: { select: { id: true, title: true } },
      },
      orderBy: [{ donatedAt: 'desc' }, { createdAt: 'desc' }],
      take: POINTS_HISTORY_MAX,
    });
    const { entries, rule } = computePoints(recent);
    return { total: Number(agg?.total ?? 0), count: Number(agg?.count ?? 0), entries, rule };
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

/**
 * Prisma unique violation (P2002) pada field `field` (atau kolom DB `column`).
 * `meta.target` bisa berupa array nama field/kolom atau nama constraint; bila tidak ada, anggap cocok.
 */
export function isUniqueViolation(e: unknown, field: string, column = field): boolean {
  if (!(e instanceof Prisma.PrismaClientKnownRequestError) || e.code !== 'P2002') return false;
  const target = (e.meta as { target?: unknown } | undefined)?.target;
  if (Array.isArray(target)) return target.includes(field) || target.includes(column);
  if (typeof target === 'string') return target.includes(field) || target.includes(column);
  return true;
}
