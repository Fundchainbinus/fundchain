/**
 * BFD-56 — GET /campaigns menyertakan `integritySummary` per campaign supaya beranda tidak perlu
 * fetch detail tiap kartu (N+1). Prisma palsu, tanpa DB.
 */
import { describe, expect, it, vi } from 'vitest';
import { AuditService } from './modules/audit/audit.service';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { StorageService } from './modules/storage/storage.service';

function row(id: string, donations: number) {
  return {
    id,
    title: `Campaign ${id}`,
    description: 'deskripsi',
    sdgCategory: 'SDG_4',
    targetAmount: 1_000_000,
    currentAmount: 250_000,
    deadline: new Date('2027-01-01'),
    status: 'ACTIVE',
    rejectionReason: null,
    frozenReason: null,
    createdAt: new Date('2026-11-01'),
    updatedAt: new Date('2026-11-01'),
    creator: { id: 'u-1', name: 'Ani' },
    _count: { donations },
  };
}

function setup(rows: ReturnType<typeof row>[], groups: { campaignId: string; integrityStatus: string; _count: number }[]) {
  const findMany = vi.fn(async () => rows);
  const groupBy = vi.fn(async () => groups);
  const docFindMany = vi.fn(async () => [
    { id: 'd-new', campaignId: 'c-1', originalName: 'proposal-v2.pdf', size: 2048, createdAt: new Date('2026-11-03') },
    { id: 'd-old', campaignId: 'c-1', originalName: 'proposal-v1.pdf', size: 1024, createdAt: new Date('2026-11-02') },
  ]);
  const prisma = {
    campaign: { findMany },
    donation: { groupBy },
    campaignDocument: { findMany: docFindMany },
    auditLog: { create: vi.fn() },
  } as any;
  const service = new CampaignsService(prisma, new AuditService(prisma), {} as StorageService);
  return { service, findMany, groupBy, docFindMany };
}

describe('CampaignsService.list — proposal di list admin (BFD-58 N+1)', () => {
  it('admin: satu query dokumen, proposal terbaru per campaign, null bila belum ada', async () => {
    const { service, docFindMany } = setup([row('c-1', 0), row('c-2', 0)], []);
    const res = await service.list({} as any, undefined, true);
    expect(docFindMany).toHaveBeenCalledTimes(1);
    expect((docFindMany.mock.calls[0] as any)[0].where.campaignId.in).toEqual(['c-1', 'c-2']);
    expect(res.campaigns.map((c: any) => [c.id, c.proposal])).toEqual([
      ['c-1', { id: 'd-new', originalName: 'proposal-v2.pdf', size: 2048 }],
      ['c-2', null],
    ]);
  });

  it('publik: tidak query dokumen dan tidak ada field proposal', async () => {
    const { service, docFindMany } = setup([row('c-1', 0)], []);
    const res = await service.list({ status: 'ACTIVE' } as any);
    expect(docFindMany).not.toHaveBeenCalled();
    expect(res.campaigns[0]).not.toHaveProperty('proposal');
  });
});

describe('CampaignsService.list — integritySummary (BFD-56)', () => {
  it('menambahkan integritySummary per campaign dari satu groupBy, field lama tetap', async () => {
    const { service, groupBy } = setup(
      [row('c-1', 3), row('c-2', 1), row('c-3', 0)],
      [
        { campaignId: 'c-1', integrityStatus: 'VERIFIED', _count: 2 },
        { campaignId: 'c-1', integrityStatus: 'PENDING', _count: 1 },
        { campaignId: 'c-2', integrityStatus: 'TAMPERED', _count: 1 },
      ],
    );

    const res = await service.list({ status: 'ACTIVE' } as any);

    expect(groupBy).toHaveBeenCalledTimes(1);
    expect(groupBy).toHaveBeenCalledWith({
      by: ['campaignId', 'integrityStatus'],
      where: { campaignId: { in: ['c-1', 'c-2', 'c-3'] }, status: 'PAID' },
      _count: true,
    });
    expect(res.campaigns.map((c) => [c.id, c.donorCount, c.integritySummary])).toEqual([
      ['c-1', 3, { VERIFIED: 2, PENDING: 1 }],
      ['c-2', 1, { TAMPERED: 1 }],
      ['c-3', 0, {}],
    ]);
    expect(res.campaigns[0]).toMatchObject({ title: 'Campaign c-1', creator: { id: 'u-1', name: 'Ani' } });
    expect(res.campaigns[0]).not.toHaveProperty('_count');
  });

  it('hanya mengelompokkan campaign di halaman ini (baris ekstra untuk cursor tidak ikut)', async () => {
    const { service, groupBy } = setup([row('c-1', 0), row('c-2', 0), row('c-3', 0)], []);
    const res = await service.list({ status: 'ACTIVE', limit: 2 } as any);
    expect(res.campaigns).toHaveLength(2);
    expect(res.nextCursor).toBe('c-2');
    expect((groupBy.mock.calls[0] as any)[0].where.campaignId.in).toEqual(['c-1', 'c-2']);
  });

  it('list kosong tidak menjalankan groupBy', async () => {
    const { service, groupBy } = setup([], []);
    const res = await service.list({ status: 'ACTIVE' } as any);
    expect(res.campaigns).toEqual([]);
    expect(groupBy).not.toHaveBeenCalled();
  });
});
