import { Injectable } from '@nestjs/common';
import { CAMPAIGN_STATUSES, LIMITS, PUBLIC_CAMPAIGN_STATUSES, type CampaignStatus } from '@fundchain/shared';
import { Prisma } from '@prisma/client';
import { AppError } from '../../common/app-error';
import type { CurrentUserPayload } from '../../common/auth';
import { Db, PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { StorageService } from '../storage/storage.service';
import { assertTransition, CAMPAIGN_TRANSITIONS, EDITABLE_STATUSES } from './campaign-status';
import { CreateCampaignDto, ListCampaignsQuery, UpdateCampaignDto } from './campaigns.dto';

const LIST_SELECT = {
  id: true,
  title: true,
  description: true,
  sdgCategory: true,
  targetAmount: true,
  currentAmount: true,
  deadline: true,
  status: true,
  rejectionReason: true,
  frozenReason: true,
  createdAt: true,
  updatedAt: true,
  creator: { select: { id: true, name: true } },
  _count: { select: { donations: { where: { status: 'PAID' } } } },
} satisfies Prisma.CampaignSelect;

@Injectable()
export class CampaignsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly storage: StorageService,
  ) {}

  async list(query: ListCampaignsQuery, user?: CurrentUserPayload, adminScope = false) {
    const limit = query.limit ?? 24;
    const mine = query.mine === 'true';
    if (mine && !user) throw new AppError('AUTH_UNAUTHENTICATED', 'Pilih pengguna terlebih dahulu.');

    const requested = (query.status?.split(',').filter(Boolean) ?? []) as CampaignStatus[];
    if (requested.some((s) => !CAMPAIGN_STATUSES.includes(s))) {
      throw new AppError('VALIDATION_ERROR', 'Filter status tidak valid.');
    }
    // Publik hanya boleh melihat status publik; "mine" & admin boleh semua status.
    const statuses = mine || adminScope
      ? requested
      : (requested.length ? requested : (['ACTIVE'] as CampaignStatus[])).filter((s) =>
          PUBLIC_CAMPAIGN_STATUSES.includes(s),
        );
    if (!mine && !adminScope && statuses.length === 0) return { campaigns: [], nextCursor: null };

    const rows = await this.prisma.campaign.findMany({
      where: {
        creatorId: mine ? user!.id : undefined,
        status: statuses.length ? { in: statuses } : undefined,
        sdgCategory: query.sdg || undefined,
        OR: query.q
          ? [
              { title: { contains: query.q, mode: 'insensitive' } },
              { description: { contains: query.q, mode: 'insensitive' } },
            ]
          : undefined,
      },
      select: LIST_SELECT,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const page = rows.slice(0, limit);
    return {
      campaigns: page.map(({ _count, ...c }) => ({ ...c, donorCount: _count.donations })),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    };
  }

  /** Detail campaign. Status non-publik hanya untuk pemilik & admin. */
  async getDetail(id: string, user?: CurrentUserPayload) {
    const campaign = await this.prisma.campaign.findUnique({
      where: { id },
      include: {
        creator: { select: { id: true, name: true } },
        documents: { orderBy: { createdAt: 'desc' } },
        reviews: {
          orderBy: { createdAt: 'desc' },
          include: { admin: { select: { name: true } } },
        },
      },
    });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');

    const isOwner = user?.id === campaign.creatorId;
    const isAdmin = user?.role === 'ADMIN';
    if (!PUBLIC_CAMPAIGN_STATUSES.includes(campaign.status as CampaignStatus) && !isOwner && !isAdmin) {
      throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    }

    const [integrity, disbursed, donorCount] = await Promise.all([
      this.prisma.donation.groupBy({
        by: ['integrityStatus'],
        where: { campaignId: id, status: 'PAID' },
        _count: true,
      }),
      this.prisma.disbursement.groupBy({
        by: ['status'],
        where: { campaignId: id },
        _sum: { amount: true },
      }),
      this.prisma.donation.count({ where: { campaignId: id, status: 'PAID' } }),
    ]);

    const sumBy = (s: string) => disbursed.find((d) => d.status === s)?._sum.amount ?? 0;
    const committed = sumBy('REQUESTED') + sumBy('APPROVED') + sumBy('PAID');

    return {
      ...campaign,
      reviews: isOwner || isAdmin ? campaign.reviews : [],
      donorCount,
      integritySummary: Object.fromEntries(integrity.map((g) => [g.integrityStatus, g._count])),
      funds: {
        raised: campaign.currentAmount,
        disbursed: sumBy('PAID'),
        approved: sumBy('APPROVED'),
        requested: sumBy('REQUESTED'),
        available: Math.max(campaign.currentAmount - committed, 0),
      },
      viewer: { isOwner, isAdmin },
    };
  }

  async create(dto: CreateCampaignDto, user: CurrentUserPayload, ip: string | null) {
    this.assertMinDeadline(dto.deadline);
    const campaign = await this.prisma.campaign.create({
      data: {
        creatorId: user.id,
        title: dto.title,
        description: dto.description,
        sdgCategory: dto.sdgCategory,
        targetAmount: dto.targetAmount,
        deadline: new Date(dto.deadline),
        status: 'DRAFT',
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'CAMPAIGN_CREATED',
      entityType: 'Campaign',
      entityId: campaign.id,
      metadata: { title: campaign.title, targetAmount: campaign.targetAmount },
      ipAddress: ip,
    });
    return campaign;
  }

  async update(id: string, dto: UpdateCampaignDto, user: CurrentUserPayload, ip: string | null) {
    const campaign = await this.getOwned(id, user);
    if (!EDITABLE_STATUSES.includes(campaign.status as CampaignStatus)) {
      throw new AppError('CAMPAIGN_INVALID_STATUS', 'Campaign hanya bisa diedit saat DRAFT atau REJECTED.');
    }
    if (dto.deadline) {
      // Deadline yang tidak diubah cukup masih di masa depan; deadline baru wajib >= H+2.
      if (new Date(dto.deadline).getTime() === campaign.deadline.getTime()) this.assertFutureDeadline(dto.deadline);
      else this.assertMinDeadline(dto.deadline);
    }
    const updated = await this.prisma.campaign.update({
      where: { id },
      data: { ...dto, deadline: dto.deadline ? new Date(dto.deadline) : undefined },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'CAMPAIGN_UPDATED',
      entityType: 'Campaign',
      entityId: id,
      metadata: { fields: Object.keys(dto) },
      ipAddress: ip,
    });
    return updated;
  }

  async uploadDocument(id: string, file: Express.Multer.File | undefined, user: CurrentUserPayload, ip: string | null) {
    const campaign = await this.getOwned(id, user);
    if (!EDITABLE_STATUSES.includes(campaign.status as CampaignStatus)) {
      throw new AppError('CAMPAIGN_INVALID_STATUS', 'Proposal hanya bisa diunggah saat DRAFT atau REJECTED.');
    }
    const stored = await this.storage.save(file, `proposals/${id}`, ['pdf']);
    const doc = await this.prisma.campaignDocument.create({
      data: {
        campaignId: id,
        originalName: stored.originalName,
        storageKey: stored.key,
        fileType: stored.fileType,
        size: stored.size,
      },
    });
    await this.audit.log({
      actorId: user.id,
      action: 'CAMPAIGN_PROPOSAL_UPLOADED',
      entityType: 'Campaign',
      entityId: id,
      metadata: { documentId: doc.id, name: doc.originalName, size: doc.size },
      ipAddress: ip,
    });
    return doc;
  }

  /** Cek hak lihat dokumen: campaign publik, atau pemilik/admin. */
  async assertDocumentVisible(documentId: string, user?: CurrentUserPayload) {
    const doc = await this.prisma.campaignDocument.findUnique({ where: { id: documentId } });
    if (!doc) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
    try {
      await this.getDetail(doc.campaignId, user);
    } catch (e) {
      if (e instanceof AppError && e.code === 'CAMPAIGN_NOT_FOUND') {
        throw new AppError(
          'AUTH_FORBIDDEN',
          'Proposal campaign yang belum disetujui hanya untuk pembuat & admin. Buka lewat tombol "Lihat proposal" di aplikasi (muat ulang halaman dengan Ctrl+Shift+R bila perlu).',
        );
      }
      throw e;
    }
    return doc;
  }

  /** `signedOk` = URL membawa tanda tangan valid (sudah diotorisasi saat link dibuat). */
  async openDocument(documentId: string, user?: CurrentUserPayload, signedOk = false) {
    const doc = signedOk
      ? await this.prisma.campaignDocument.findUnique({ where: { id: documentId } })
      : await this.assertDocumentVisible(documentId, user);
    if (!doc) throw new AppError('NOT_FOUND', 'Dokumen tidak ditemukan.');
    return { doc, stream: await this.storage.open(doc.storageKey) };
  }

  async submit(id: string, user: CurrentUserPayload, ip: string | null) {
    const campaign = await this.getOwned(id, user);
    assertTransition(campaign.status, 'PENDING_REVIEW');
    this.assertFutureDeadline(campaign.deadline.toISOString());
    const docs = await this.prisma.campaignDocument.count({ where: { campaignId: id } });
    if (docs === 0) throw new AppError('CAMPAIGN_PROPOSAL_MISSING', 'Unggah proposal (PDF) sebelum submit.');

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.transition(tx, id, campaign.status as CampaignStatus, 'PENDING_REVIEW', {
        rejectionReason: null,
      });
      await this.audit.log(
        {
          actorId: user.id,
          action: campaign.status === 'REJECTED' ? 'CAMPAIGN_RESUBMITTED' : 'CAMPAIGN_SUBMITTED',
          entityType: 'Campaign',
          entityId: id,
          ipAddress: ip,
        },
        tx,
      );
      return updated;
    });
  }

  // ---------- Aksi admin ----------

  async review(
    id: string,
    decision: 'APPROVE' | 'REJECT',
    admin: CurrentUserPayload,
    reason: string | null,
    ip: string | null,
  ) {
    const campaign = await this.findOrThrow(id);
    const to: CampaignStatus = decision === 'APPROVE' ? 'ACTIVE' : 'REJECTED';
    assertTransition(campaign.status, to);
    if (decision === 'APPROVE' && campaign.deadline <= new Date()) {
      throw new AppError('CAMPAIGN_DEADLINE_PASSED', 'Deadline campaign sudah lewat; minta creator merevisi.');
    }
    if (decision === 'REJECT' && !reason) throw new AppError('VALIDATION_ERROR', 'Alasan penolakan wajib diisi.');

    return this.prisma.$transaction(async (tx) => {
      const updated = await this.transition(tx, id, 'PENDING_REVIEW', to, {
        rejectionReason: decision === 'REJECT' ? reason : null,
      });
      await tx.campaignReview.create({ data: { campaignId: id, adminId: admin.id, decision, reason } });
      await this.audit.log(
        {
          actorId: admin.id,
          action: decision === 'APPROVE' ? 'CAMPAIGN_APPROVED' : 'CAMPAIGN_REJECTED',
          entityType: 'Campaign',
          entityId: id,
          metadata: reason ? { reason } : {},
          ipAddress: ip,
        },
        tx,
      );
      return updated;
    });
  }

  /** Bekukan campaign. Dipanggil admin manual atau sistem (integrity TAMPERED). */
  async freeze(db: Db, id: string, reason: string, actorId: string | null, ip: string | null = null) {
    const campaign = await db.campaign.findUnique({ where: { id } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    if (campaign.status === 'FROZEN') return { campaign, changed: false };
    assertTransition(campaign.status, 'FROZEN');
    const updated = await this.transition(db, id, campaign.status as CampaignStatus, 'FROZEN', { frozenReason: reason });
    await this.audit.log(
      {
        actorId,
        action: 'CAMPAIGN_FROZEN',
        entityType: 'Campaign',
        entityId: id,
        metadata: { reason, previousStatus: campaign.status },
        ipAddress: ip,
      },
      db,
    );
    return { campaign: updated, changed: true };
  }

  async adminFreeze(id: string, admin: CurrentUserPayload, reason: string, ip: string | null) {
    return this.prisma.$transaction(async (tx) => (await this.freeze(tx, id, `Manual: ${reason}`, admin.id, ip)).campaign);
  }

  async unfreeze(id: string, admin: CurrentUserPayload, reason: string, ip: string | null) {
    const campaign = await this.findOrThrow(id);
    if (campaign.status !== 'FROZEN') {
      throw new AppError('CAMPAIGN_INVALID_STATUS', 'Hanya campaign FROZEN yang bisa di-unfreeze.');
    }
    const to: CampaignStatus = campaign.deadline <= new Date() ? 'COMPLETED' : 'ACTIVE';
    return this.prisma.$transaction(async (tx) => {
      const updated = await this.transition(tx, id, 'FROZEN', to, { frozenReason: null });
      await this.audit.log(
        {
          actorId: admin.id,
          action: 'CAMPAIGN_UNFROZEN',
          entityType: 'Campaign',
          entityId: id,
          metadata: { reason, newStatus: to },
          ipAddress: ip,
        },
        tx,
      );
      return updated;
    });
  }

  /** ACTIVE yang deadline-nya lewat → COMPLETED (dijalankan worker). */
  async completeExpired() {
    const expired = await this.prisma.campaign.findMany({
      where: { status: 'ACTIVE', deadline: { lte: new Date() } },
      select: { id: true },
    });
    for (const { id } of expired) {
      await this.prisma.$transaction(async (tx) => {
        await this.transition(tx, id, 'ACTIVE', 'COMPLETED', {});
        await this.audit.log({ action: 'CAMPAIGN_COMPLETED', entityType: 'Campaign', entityId: id }, tx);
      }).catch(() => undefined); // status berubah di tengah jalan → lewati
    }
    return expired.length;
  }

  // ---------- helpers ----------

  async findOrThrow(id: string) {
    const campaign = await this.prisma.campaign.findUnique({ where: { id } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    return campaign;
  }

  async getOwned(id: string, user: CurrentUserPayload) {
    const campaign = await this.findOrThrow(id);
    if (campaign.creatorId !== user.id) {
      throw new AppError('CAMPAIGN_NOT_OWNED', 'Anda bukan pembuat campaign ini.');
    }
    return campaign;
  }

  /** Update status secara atomic: hanya berhasil jika status saat ini masih `from`. */
  private async transition(
    db: Db,
    id: string,
    from: CampaignStatus,
    to: CampaignStatus,
    data: Prisma.CampaignUpdateManyMutationInput,
  ) {
    if (!CAMPAIGN_TRANSITIONS[from].includes(to)) assertTransition(from, to);
    const { count } = await db.campaign.updateMany({ where: { id, status: from }, data: { ...data, status: to } });
    if (count === 0) {
      throw new AppError('CAMPAIGN_INVALID_STATUS', 'Status campaign sudah berubah, muat ulang halaman.');
    }
    return db.campaign.findUniqueOrThrow({ where: { id } });
  }

  private assertFutureDeadline(deadline: string) {
    if (new Date(deadline).getTime() <= Date.now()) {
      throw new AppError('CAMPAIGN_DEADLINE_PASSED', 'Deadline harus di masa depan.');
    }
  }

  /** Frontend mengirim akhir hari (23:59:59) dari tanggal H+2, jadi selalu > 2x24 jam dari sekarang. */
  private assertMinDeadline(deadline: string) {
    this.assertFutureDeadline(deadline);
    if (new Date(deadline).getTime() <= Date.now() + LIMITS.DEADLINE_MIN_DAYS * 86_400_000) {
      throw new AppError('CAMPAIGN_DEADLINE_TOO_SOON', `Deadline minimal ${LIMITS.DEADLINE_MIN_DAYS} hari dari hari ini.`);
    }
  }
}
