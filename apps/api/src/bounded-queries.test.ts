/**
 * BUG-009..012 (#27–#30): query yang dulu tanpa batas kini dibatasi (`take`), hanya memuat kolom
 * yang dipakai, dan total dihitung di DB. Prisma palsu, tanpa DB maupun RPC.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('./modules/payments/payments.service', () => ({ PaymentsService: class {} }));
vi.mock('./modules/storage/storage.service', () => ({ StorageService: class {} }));

import { CampaignsService, HOUSEKEEPING_BATCH } from './modules/campaigns/campaigns.service';
import { DISBURSEMENT_LIST_MAX, DisbursementsService } from './modules/disbursements/disbursements.service';
import {
  DonationsService,
  MY_DONATIONS_DEFAULT,
  MY_DONATIONS_MAX,
  POINTS_HISTORY_MAX,
  clampMyDonationsLimit,
} from './modules/donations/donations.service';

const student = { id: 'u-1', role: 'STUDENT' } as any;
const audit = { log: vi.fn() } as any;

function donationRow(id: string, status = 'PAID', amount = 25_000) {
  return {
    id,
    amount,
    status,
    isAnonymous: false,
    createdAt: new Date('2026-11-20'),
    donatedAt: new Date('2026-11-20'),
    integrityStatus: 'VERIFIED',
    campaign: { id: 'c-1', title: 'Air Bersih', status: 'ACTIVE' },
    payment: { status: 'SETTLED' },
    blockchain: { status: 'CONFIRMED', txHash: '0xabc' },
  };
}

function donationsSetup(rows: ReturnType<typeof donationRow>[] = []) {
  const prisma: any = {
    donation: {
      findMany: vi.fn(async () => rows),
      groupBy: vi.fn(async () => [
        { status: 'PAID', _count: { _all: 3 }, _sum: { amount: 75_000 } },
        { status: 'PENDING', _count: { _all: 1 }, _sum: { amount: 10_000 } },
        { status: 'EXPIRED', _count: { _all: 2 }, _sum: { amount: 20_000 } },
      ]),
    },
    $queryRaw: vi.fn(async () => [{ total: 7n, count: 3n }]),
  };
  const service = new DonationsService(prisma, audit, {} as any, {} as any);
  return { prisma, service };
}

describe('GET /me/donations (BUG-009 / #27)', () => {
  it('dibatasi per halaman dan hanya memilih kolom yang dipakai web', async () => {
    const { prisma, service } = donationsSetup();
    await service.listMine(student);
    const q = prisma.donation.findMany.mock.calls[0][0];
    expect(q.take).toBe(MY_DONATIONS_DEFAULT + 1);
    expect(q.include).toBeUndefined();
    expect(q.select.payment).toEqual({ select: { status: true } });
    expect(q.select.blockchain).toEqual({ select: { status: true, txHash: true } });
  });

  it('limit di-clamp 1..MAX; nilai aneh jatuh ke default', () => {
    expect(clampMyDonationsLimit('5000')).toBe(MY_DONATIONS_MAX);
    expect(clampMyDonationsLimit('0')).toBe(1);
    expect(clampMyDonationsLimit('abc')).toBe(MY_DONATIONS_DEFAULT);
    expect(clampMyDonationsLimit(undefined)).toBe(MY_DONATIONS_DEFAULT);
  });

  it('nextCursor diisi bila masih ada halaman berikut; ringkasan dari DB (FAILED = FAILED + EXPIRED)', async () => {
    const rows = [donationRow('d-1'), donationRow('d-2'), donationRow('d-3')];
    const { service } = donationsSetup(rows);
    const res = await service.listMine(student, { limit: '2' });
    expect(res.donations.map((d) => d.id)).toEqual(['d-1', 'd-2']);
    expect(res.nextCursor).toBe('d-2');
    expect(res.summary).toEqual({ counts: { ALL: 6, PAID: 3, PENDING: 1, FAILED: 2 }, paidTotal: 75_000 });
  });

  it('tab FAILED memfilter FAILED + EXPIRED di server; status tak dikenal ditolak', async () => {
    const { prisma, service } = donationsSetup();
    await service.listMine(student, { status: 'FAILED' });
    expect(prisma.donation.findMany.mock.calls[0][0].where.status).toEqual({ in: ['FAILED', 'EXPIRED'] });
    await expect(service.listMine(student, { status: 'DROP TABLE' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});

describe('GET /me/points (BUG-010 / #28)', () => {
  it('total & jumlah dari agregasi DB; riwayat dibatasi', async () => {
    const { prisma, service } = donationsSetup([donationRow('d-1', 'PAID', 25_000)]);
    const res = await service.pointsMine(student);
    expect(prisma.$queryRaw).toHaveBeenCalledTimes(1);
    expect(res.total).toBe(7);
    expect(res.count).toBe(3);
    expect(prisma.donation.findMany.mock.calls[0][0].take).toBe(POINTS_HISTORY_MAX);
    expect(res.entries).toHaveLength(1);
  });
});

describe('Housekeeping campaign (BUG-011 / #29)', () => {
  function campaignsSetup() {
    const prisma: any = { campaign: { findMany: vi.fn(async () => []) } };
    return { prisma, service: new CampaignsService(prisma, audit, {} as any) };
  }

  it('completeExpired: terlama dulu, maksimal HOUSEKEEPING_BATCH per tick', async () => {
    const { prisma, service } = campaignsSetup();
    await service.completeExpired();
    const q = prisma.campaign.findMany.mock.calls[0][0];
    expect(q.take).toBe(HOUSEKEEPING_BATCH);
    expect(q.orderBy).toEqual({ deadline: 'asc' });
  });

  it('softDeleteFrozen: terlama dulu, maksimal HOUSEKEEPING_BATCH per tick', async () => {
    const { prisma, service } = campaignsSetup();
    await service.softDeleteFrozen();
    const q = prisma.campaign.findMany.mock.calls[0][0];
    expect(q.take).toBe(HOUSEKEEPING_BATCH);
    expect(q.orderBy).toEqual({ frozenAt: 'asc' });
  });
});

describe('Pencairan per campaign (BUG-012 / #30)', () => {
  function disbSetup() {
    const prisma: any = {
      campaign: { findUnique: vi.fn(async () => ({ id: 'c-1', creatorId: 'u-1' })) },
      disbursement: { findMany: vi.fn(async () => []) },
    };
    return { prisma, service: new DisbursementsService(prisma, audit, {} as any) };
  }

  it('listForCampaign dibatasi dan memakai select', async () => {
    const { prisma, service } = disbSetup();
    await service.listForCampaign('c-1', student);
    const q = prisma.disbursement.findMany.mock.calls[0][0];
    expect(q.take).toBe(DISBURSEMENT_LIST_MAX);
    expect(q.include).toBeUndefined();
    expect(q.select.proofKey).toBeUndefined();
  });

  it('milestones dibatasi dan tidak memuat pengajuan yang ditolak', async () => {
    const { prisma, service } = disbSetup();
    await service.milestones('c-1');
    const q = prisma.disbursement.findMany.mock.calls[0][0];
    expect(q.take).toBe(DISBURSEMENT_LIST_MAX);
    expect(q.where.status).toEqual({ not: 'REJECTED' });
  });
});
