import { Injectable } from '@nestjs/common';
import { LIMITS, type CampaignStatus, type DisbursementStatus } from '@fundchain/shared';
import { AppError } from '../../common/app-error';
import type { CurrentUserPayload } from '../../common/auth';
import { Db, PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { DISBURSABLE_STATUSES } from '../campaigns/campaign-status';
import { StorageService } from '../storage/storage.service';

/** Dana yang sudah dikunci oleh pengajuan aktif/selesai. */
const COMMITTED: DisbursementStatus[] = ['REQUESTED', 'APPROVED', 'PAID'];

export function assertDisbursable(status: string) {
  if (status === 'FROZEN') {
    throw new AppError('CAMPAIGN_FROZEN', 'Campaign dibekukan karena masalah integritas — pencairan terkunci.');
  }
  if (!DISBURSABLE_STATUSES.includes(status as CampaignStatus)) {
    throw new AppError('DISBURSEMENT_NOT_ELIGIBLE', 'Campaign belum memenuhi syarat pencairan.');
  }
}

@Injectable()
export class DisbursementsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async available(db: Db, campaignId: string, currentAmount: number) {
    const agg = await db.disbursement.aggregate({
      where: { campaignId, status: { in: COMMITTED } },
      _sum: { amount: true },
    });
    return currentAmount - (agg._sum.amount ?? 0);
  }

  async create(
    campaignId: string,
    input: { amount: number; description: string },
    file: Express.Multer.File | undefined,
    user: CurrentUserPayload,
    ip: string | null,
  ) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    if (campaign.creatorId !== user.id) {
      throw new AppError('CAMPAIGN_NOT_OWNED', 'Hanya pembuat campaign yang dapat mengajukan pencairan.');
    }
    assertDisbursable(campaign.status);
    if (!file) throw new AppError('DISBURSEMENT_PROOF_REQUIRED', 'Bukti milestone / rencana penggunaan dana wajib diunggah.');
    if (!Number.isInteger(input.amount) || input.amount <= 0) {
      throw new AppError('VALIDATION_ERROR', 'Nominal pencairan harus bilangan bulat positif.');
    }
    if (!input.description || input.description.trim().length < LIMITS.REASON_MIN) {
      throw new AppError('VALIDATION_ERROR', `Deskripsi minimal ${LIMITS.REASON_MIN} karakter.`);
    }
    if (input.amount > (await this.available(this.prisma, campaignId, campaign.currentAmount))) {
      throw new AppError('DISBURSEMENT_AMOUNT_EXCEEDS', 'Nominal melebihi sisa dana yang dapat dicairkan.');
    }

    const proof = await this.storage.save(file, `disbursements/${campaignId}`, ['pdf', 'png', 'jpg']);
    return this.prisma.$transaction(async (tx) => {
      // Cek ulang di dalam transaksi supaya dua pengajuan bersamaan tidak melebihi saldo.
      const fresh = await tx.campaign.findUniqueOrThrow({ where: { id: campaignId } });
      assertDisbursable(fresh.status);
      if (input.amount > (await this.available(tx, campaignId, fresh.currentAmount))) {
        throw new AppError('DISBURSEMENT_AMOUNT_EXCEEDS', 'Nominal melebihi sisa dana yang dapat dicairkan.');
      }
      const created = await tx.disbursement.create({
        data: {
          campaignId,
          requesterId: user.id,
          amount: input.amount,
          description: input.description.trim(),
          proofKey: proof.key,
          proofName: proof.originalName,
          proofType: proof.fileType,
        },
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: 'DISBURSEMENT_REQUESTED',
          entityType: 'Campaign',
          entityId: campaignId,
          metadata: { disbursementId: created.id, amount: created.amount },
          ipAddress: ip,
        },
        tx,
      );
      return created;
    });
  }

  async listForCampaign(campaignId: string, viewer?: CurrentUserPayload) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id: campaignId } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    const privileged = viewer?.role === 'ADMIN' || viewer?.id === campaign.creatorId;
    const rows = await this.prisma.disbursement.findMany({
      where: { campaignId },
      include: { admin: { select: { name: true } } },
      orderBy: { requestedAt: 'desc' },
    });
    // Publik melihat ringkasan (transparansi); bukti hanya untuk pemilik/admin.
    return rows.map((d) => ({
      id: d.id,
      amount: d.amount,
      description: d.description,
      status: d.status,
      rejectionReason: d.rejectionReason,
      requestedAt: d.requestedAt,
      approvedAt: d.approvedAt,
      paidAt: d.paidAt,
      reviewedBy: d.admin?.name ?? null,
      ...(privileged ? { proofName: d.proofName, proofType: d.proofType } : {}),
    }));
  }

  async listAdmin(status?: string) {
    return this.prisma.disbursement.findMany({
      where: { status: status || undefined },
      include: {
        campaign: { select: { id: true, title: true, status: true, currentAmount: true } },
        requester: { select: { id: true, name: true } },
        admin: { select: { name: true } },
      },
      orderBy: { requestedAt: 'desc' },
      take: 200,
    });
  }

  async openProof(id: string, viewer: CurrentUserPayload) {
    const d = await this.prisma.disbursement.findUnique({ where: { id } });
    if (!d) throw new AppError('DISBURSEMENT_NOT_FOUND', 'Pengajuan tidak ditemukan.');
    if (viewer.role !== 'ADMIN' && viewer.id !== d.requesterId) {
      throw new AppError('AUTH_FORBIDDEN', 'Anda tidak memiliki akses ke bukti ini.');
    }
    return { d, stream: this.storage.open(d.proofKey) };
  }

  async decide(
    id: string,
    action: 'APPROVE' | 'REJECT' | 'MARK_PAID',
    admin: CurrentUserPayload,
    reason: string | null,
    ip: string | null,
  ) {
    const from: DisbursementStatus = action === 'MARK_PAID' ? 'APPROVED' : 'REQUESTED';
    const to: DisbursementStatus = action === 'APPROVE' ? 'APPROVED' : action === 'REJECT' ? 'REJECTED' : 'PAID';

    return this.prisma.$transaction(async (tx) => {
      const d = await tx.disbursement.findUnique({ where: { id }, include: { campaign: true } });
      if (!d) throw new AppError('DISBURSEMENT_NOT_FOUND', 'Pengajuan tidak ditemukan.');
      if (d.status !== from) {
        throw new AppError('DISBURSEMENT_INVALID_STATUS', `Pengajuan berstatus ${d.status}, tidak bisa ${action}.`);
      }
      // FROZEN mengunci approve & pembayaran (BR-DIS-004). Reject tetap boleh.
      if (action !== 'REJECT') assertDisbursable(d.campaign.status);

      const now = new Date();
      const { count } = await tx.disbursement.updateMany({
        where: { id, status: from },
        data: {
          status: to,
          adminId: admin.id,
          rejectionReason: action === 'REJECT' ? reason : undefined,
          approvedAt: action === 'APPROVE' ? now : undefined,
          paidAt: action === 'MARK_PAID' ? now : undefined,
        },
      });
      if (count === 0) throw new AppError('DISBURSEMENT_INVALID_STATUS', 'Status pengajuan sudah berubah.');
      await this.audit.log(
        {
          actorId: admin.id,
          action: `DISBURSEMENT_${to}`,
          entityType: 'Campaign',
          entityId: d.campaignId,
          metadata: { disbursementId: id, amount: d.amount, ...(reason ? { reason } : {}) },
          ipAddress: ip,
        },
        tx,
      );
      return tx.disbursement.findUniqueOrThrow({ where: { id } });
    });
  }
}
