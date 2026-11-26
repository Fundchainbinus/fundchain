import { Injectable } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { Prisma } from '@prisma/client';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppError } from '../../common/app-error';
import type { CurrentUserPayload } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PaymentsService } from '../payments/payments.service';

/** Provider pembayaran untuk dana CSR: transfer bank berdasarkan MoU, dicatat admin (bukan QRIS). */
export const CSR_PROVIDER = 'csr-transfer';

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);

function isUniqueViolation(e: unknown) {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

/**
 * Mitra CSR perusahaan (BFD-101/102).
 *
 * Dana CSR masuk lewat transfer bank sesuai MoU, lalu admin mencatatnya. Pencatatan memakai jalur
 * settlement yang sama dengan QRIS (PaymentsService.applyEvent): donasi PAID → canonical payload →
 * hash → antre notarisasi. Jadi kontribusi perusahaan punya bukti blockchain yang sama dengan donasi
 * mahasiswa, dan ikut aturan pencairan 20/40/60/80/100%.
 */
@Injectable()
export class CsrService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly payments: PaymentsService,
  ) {}

  /** Daftar mitra publik + total kontribusi PAID dan campaign yang didukung. */
  async listCompanies() {
    const companies = await this.prisma.company.findMany({ orderBy: { name: 'asc' } });
    if (!companies.length) return [];
    const rows = await this.prisma.donation.groupBy({
      by: ['donorId', 'campaignId'],
      where: { status: 'PAID', donorId: { in: companies.map((c) => c.userId) } },
      _sum: { amount: true },
    });
    const campaigns = await this.prisma.campaign.findMany({
      where: { id: { in: [...new Set(rows.map((r) => r.campaignId))] } },
      select: { id: true, title: true, status: true },
    });
    const title = new Map(campaigns.map((c) => [c.id, c]));
    return companies.map((c) => {
      const mine = rows.filter((r) => r.donorId === c.userId);
      return {
        id: c.id,
        name: c.name,
        sector: c.sector,
        website: c.website,
        description: c.description,
        totalContributed: mine.reduce((a, r) => a + (r._sum.amount ?? 0), 0),
        campaigns: mine.map((r) => ({
          id: r.campaignId,
          title: title.get(r.campaignId)?.title ?? '',
          status: title.get(r.campaignId)?.status ?? '',
          amount: r._sum.amount ?? 0,
        })),
      };
    });
  }

  /** Mitra CSR yang mendukung satu campaign (ditampilkan di halaman campaign). */
  async sponsorsOf(campaignId: string) {
    const rows = await this.prisma.donation.groupBy({
      by: ['donorId'],
      where: { campaignId, status: 'PAID', donor: { role: 'COMPANY' } },
      _sum: { amount: true },
    });
    if (!rows.length) return [];
    const companies = await this.prisma.company.findMany({ where: { userId: { in: rows.map((r) => r.donorId) } } });
    return companies
      .map((c) => ({ id: c.id, name: c.name, sector: c.sector, amount: rows.find((r) => r.donorId === c.userId)?._sum.amount ?? 0 }))
      .sort((a, b) => b.amount - a.amount);
  }

  async createCompany(input: { name: string; sector: string; website?: string; description?: string }, admin: CurrentUserPayload, ip: string | null) {
    const name = input.name.trim();
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Akun pencatat: email sintetis (domain .invalid tidak bisa dipakai login Google).
        const user = await tx.user.create({
          data: {
            email: `csr+${slug(name)}-${randomBytes(3).toString('hex')}@fundchain.invalid`,
            name,
            role: 'COMPANY',
            integritySubjectId: `CSR-${randomBytes(5).toString('hex').toUpperCase()}`,
          },
        });
        const company = await tx.company.create({
          data: { name, sector: input.sector.trim(), website: input.website?.trim() || null, description: input.description?.trim() || null, userId: user.id },
        });
        await this.audit.log(
          { actorId: admin.id, action: 'CSR_COMPANY_CREATED', entityType: 'Company', entityId: company.id, metadata: { name, sector: company.sector }, ipAddress: ip },
          tx,
        );
        return company;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('COMPANY_DUPLICATE', `Mitra "${name}" sudah terdaftar.`);
      throw e;
    }
  }

  /**
   * Catat dana CSR yang sudah diterima di rekening. `reference` = nomor transfer / MoU, unik,
   * mencegah dana yang sama tercatat dua kali.
   */
  async recordContribution(
    input: { companyId: string; campaignId: string; amount: number; reference: string },
    admin: CurrentUserPayload,
    ip: string | null,
  ) {
    const { amount } = input;
    if (!Number.isInteger(amount) || amount < LIMITS.DONATION_MIN || amount > LIMITS.DONATION_MAX) {
      throw new AppError('DONATION_AMOUNT_INVALID', 'Nominal kontribusi antara Rp10.000 dan Rp1.000.000.000.');
    }
    const company = await this.prisma.company.findUnique({ where: { id: input.companyId } });
    if (!company) throw new AppError('COMPANY_NOT_FOUND', 'Mitra CSR tidak ditemukan.');
    const campaign = await this.prisma.campaign.findUnique({ where: { id: input.campaignId } });
    if (!campaign) throw new AppError('CAMPAIGN_NOT_FOUND', 'Campaign tidak ditemukan.');
    if (campaign.status !== 'ACTIVE' || campaign.deadline <= new Date()) {
      throw new AppError('CAMPAIGN_NOT_ACTIVE', 'Campaign tidak sedang menerima donasi.');
    }
    const externalId = `CSR-${input.reference.trim()}`;

    let donationId: string;
    try {
      donationId = await this.prisma.$transaction(async (tx) => {
        const d = await tx.donation.create({
          data: { campaignId: campaign.id, donorId: company.userId, amount, idempotencyKey: `csr-${randomUUID()}`, status: 'PENDING' },
        });
        await tx.payment.create({
          data: { donationId: d.id, provider: CSR_PROVIDER, method: 'TRANSFER', amount, status: 'PENDING', externalPaymentId: externalId },
        });
        await this.audit.log(
          {
            actorId: admin.id,
            action: 'CSR_CONTRIBUTION_RECORDED',
            entityType: 'Donation',
            entityId: d.id,
            metadata: { companyId: company.id, company: company.name, campaignId: campaign.id, amount, reference: input.reference.trim() },
            ipAddress: ip,
          },
          tx,
        );
        return d.id;
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError('CSR_REFERENCE_DUPLICATE', 'Nomor referensi transfer ini sudah pernah dicatat.');
      throw e;
    }
    // Jalur settlement yang sama dengan webhook QRIS: hash + saldo campaign + antre notarisasi.
    await this.payments.applyEvent({ orderId: donationId, externalId, status: 'SETTLED', amount, method: 'TRANSFER', raw: { source: CSR_PROVIDER } });
    return { donationId, company: company.name, campaignId: campaign.id, amount, status: 'PAID' };
  }
}
