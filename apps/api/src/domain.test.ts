import { LIMITS } from '@fundchain/shared';
import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { CurrentUserPayload } from './common/auth';
import { AuditService } from './modules/audit/audit.service';
import { CampaignsService } from './modules/campaigns/campaigns.service';
import { DisbursementsService } from './modules/disbursements/disbursements.service';
import { DonationsService } from './modules/donations/donations.service';
import { StorageService } from './modules/storage/storage.service';

// Semua test di file ini memakai Prisma palsu — tidak ada koneksi DB.

const code = (c: string, status?: number) =>
  expect.objectContaining(status === undefined ? { code: c } : { code: c, status });

const owner = { id: 'user-owner', role: 'USER' } as unknown as CurrentUserPayload;
const stranger = { id: 'user-other', role: 'USER' } as unknown as CurrentUserPayload;
const admin = { id: 'user-admin', role: 'ADMIN' } as unknown as CurrentUserPayload;

const future = () => new Date(Date.now() + 30 * 86_400_000);

/** Prisma palsu minimal: `$transaction(cb)` menjalankan cb dengan client yang sama. */
function fakePrisma(models: Record<string, unknown>) {
  const auditLog = { create: vi.fn(async ({ data }: { data: unknown }) => data) };
  const db: Record<string, unknown> = { auditLog, ...models };
  db.$transaction = vi.fn(async (arg: unknown) =>
    typeof arg === 'function' ? (arg as (tx: unknown) => unknown)(db) : Promise.all(arg as unknown[]),
  );
  return db as any;
}

function campaignsWith(campaign: Record<string, unknown>) {
  const row = { id: 'camp-1', creatorId: owner.id, title: 'Sumur', deletedAt: null, deadline: future(), ...campaign };
  const prisma = fakePrisma({
    campaign: {
      findUnique: vi.fn(async () => row),
      updateMany: vi.fn(async ({ where, data }: any) => {
        const statusOk = !where.status?.in || where.status.in.includes(row.status);
        if (!statusOk || (where.deletedAt === null && row.deletedAt !== null)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      }),
    },
  });
  const service = new CampaignsService(prisma, new AuditService(prisma), {} as StorageService);
  return { service, prisma, row };
}

describe('CampaignsService — state machine lewat method service', () => {
  it('approve campaign DRAFT ditolak 409 CAMPAIGN_INVALID_STATUS tanpa menyentuh DB', async () => {
    const { service, prisma } = campaignsWith({ status: 'DRAFT' });
    await expect(service.review('camp-1', 'APPROVE', admin, null, null)).rejects.toThrowError(
      code('CAMPAIGN_INVALID_STATUS', 409),
    );
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  it('reject campaign ACTIVE ditolak 409', async () => {
    const { service } = campaignsWith({ status: 'ACTIVE' });
    await expect(service.review('camp-1', 'REJECT', admin, 'alasan', null)).rejects.toThrowError(
      code('CAMPAIGN_INVALID_STATUS', 409),
    );
  });
});

describe('CampaignsService.remove (DELETE /campaigns/:id, BFD-13)', () => {
  it('pemilik boleh menghapus campaign DRAFT: soft-delete + audit log', async () => {
    const { service, prisma, row } = campaignsWith({ status: 'DRAFT' });
    const res = await service.remove('camp-1', owner, '1.2.3.4');
    expect(res.id).toBe('camp-1');
    expect(row.deletedAt).toBeInstanceOf(Date);
    expect(prisma.auditLog.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ action: 'CAMPAIGN_DELETED', entityId: 'camp-1', actorId: owner.id }),
    });
  });

  it('pemilik boleh menghapus campaign REJECTED', async () => {
    const { service, row } = campaignsWith({ status: 'REJECTED' });
    await service.remove('camp-1', owner, null);
    expect(row.deletedAt).toBeInstanceOf(Date);
  });

  it.each(['PENDING_REVIEW', 'ACTIVE', 'COMPLETED', 'FROZEN'])('status %s ditolak 409', async (status) => {
    const { service, prisma, row } = campaignsWith({ status });
    await expect(service.remove('camp-1', owner, null)).rejects.toThrowError(code('CAMPAIGN_INVALID_STATUS', 409));
    expect(row.deletedAt).toBeNull();
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('bukan pemilik ditolak 403 CAMPAIGN_NOT_OWNED', async () => {
    const { service, row } = campaignsWith({ status: 'DRAFT' });
    await expect(service.remove('camp-1', stranger, null)).rejects.toThrowError(code('CAMPAIGN_NOT_OWNED', 403));
    expect(row.deletedAt).toBeNull();
  });

  it('status berubah di tengah jalan (updateMany count 0) → 409, tanpa audit', async () => {
    const { service, prisma } = campaignsWith({ status: 'DRAFT' });
    prisma.campaign.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(service.remove('camp-1', owner, null)).rejects.toThrowError(code('CAMPAIGN_INVALID_STATUS', 409));
    expect(prisma.auditLog.create).not.toHaveBeenCalled();
  });

  it('campaign yang sudah dihapus dianggap tidak ada (tidak bisa dihapus/diedit lagi)', async () => {
    const { service } = campaignsWith({ status: 'DRAFT', deletedAt: new Date() });
    await expect(service.remove('camp-1', owner, null)).rejects.toThrowError(code('CAMPAIGN_NOT_FOUND', 404));
    await expect(service.submit('camp-1', owner, null)).rejects.toThrowError(code('CAMPAIGN_NOT_FOUND'));
  });

  it('list publik & milik sendiri menyaring deletedAt; detail menyembunyikan dari non-admin', async () => {
    const findMany = vi.fn(async () => []);
    const deleted = { id: 'camp-1', creatorId: owner.id, status: 'DRAFT', deletedAt: new Date() };
    const prisma = fakePrisma({ campaign: { findMany, findUnique: vi.fn(async () => deleted) } });
    const service = new CampaignsService(prisma, new AuditService(prisma), {} as StorageService);

    await service.list({ mine: 'true' } as any, owner);
    await service.list({} as any);
    for (const [args] of findMany.mock.calls as any[]) expect(args.where.deletedAt).toBeNull();
    await expect(service.getDetail('camp-1', owner)).rejects.toThrowError(code('CAMPAIGN_NOT_FOUND'));
  });
});

describe('StorageService.save — validasi file', () => {
  const storedFile = { create: vi.fn() };
  const storage = new StorageService(fakePrisma({ storedFile }));
  const file = (buffer: Buffer, size = buffer.length, name = 'proposal.pdf') =>
    ({ originalname: name, mimetype: 'application/pdf', buffer, size }) as Express.Multer.File;

  it('menolak file ber-ekstensi .pdf tapi magic bytes bukan PDF → INVALID_FILE_TYPE (400)', async () => {
    const fake = file(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    await expect(storage.save(fake, 'proposals/x', ['pdf'])).rejects.toThrowError(code('INVALID_FILE_TYPE', 400));
    expect(storedFile.create).not.toHaveBeenCalled();
  });

  it('menolak file melebihi batas ukuran → FILE_TOO_LARGE', async () => {
    const big = file(Buffer.from('%PDF-1.7'), LIMITS.FILE_MAX_BYTES + 1);
    await expect(storage.save(big, 'proposals/x', ['pdf'])).rejects.toThrowError(code('FILE_TOO_LARGE', 400));
    expect(storedFile.create).not.toHaveBeenCalled();
  });

  it('menerima PDF valid', async () => {
    const ok = await storage.save(file(Buffer.from('%PDF-1.7\n...')), 'proposals/x', ['pdf']);
    expect(ok).toMatchObject({ fileType: 'application/pdf', originalName: 'proposal.pdf' });
    expect(ok.key).toMatch(/^proposals\/x\/.+\.pdf$/);
  });
});

describe('DisbursementsService.decide', () => {
  it('APPROVE dua kali → yang kedua 409 DISBURSEMENT_INVALID_STATUS', async () => {
    const row = { id: 'd-1', campaignId: 'camp-1', amount: 100_000, status: 'REQUESTED', campaign: { status: 'ACTIVE' } };
    const disbursement = {
      findUnique: vi.fn(async () => ({ ...row })),
      findUniqueOrThrow: vi.fn(async () => ({ ...row })),
      updateMany: vi.fn(async ({ where, data }: any) => {
        if (row.status !== where.status) return { count: 0 };
        row.status = data.status;
        return { count: 1 };
      }),
    };
    const prisma = fakePrisma({ disbursement });
    const service = new DisbursementsService(prisma, new AuditService(prisma), {} as StorageService);

    await expect(service.decide('d-1', 'APPROVE', admin, null, null)).resolves.toMatchObject({ status: 'APPROVED' });
    await expect(service.decide('d-1', 'APPROVE', admin, null, null)).rejects.toThrowError(
      code('DISBURSEMENT_INVALID_STATUS', 409),
    );
    expect(disbursement.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.auditLog.create).toHaveBeenCalledTimes(1);
  });
});

describe('DonationsService.create — race Idempotency-Key (BFD-17/46)', () => {
  const KEY = 'idem-key-12345';
  const p2002 = () =>
    new Prisma.PrismaClientKnownRequestError('Unique constraint failed on the fields: (`idempotency_key`)', {
      code: 'P2002',
      clientVersion: '6.0.0',
      meta: { target: ['idempotency_key'] },
    });

  function setup(winner: Record<string, unknown> | null, txError: unknown = p2002()) {
    const donationFind = vi
      .fn()
      .mockResolvedValueOnce(null) // pre-check: belum ada (request lain belum commit)
      .mockResolvedValue(winner); // setelah P2002: baris milik request pemenang
    const prisma = fakePrisma({
      donation: { findUnique: donationFind },
      campaign: { findUnique: vi.fn(async () => ({ id: 'camp-1', status: 'ACTIVE', deadline: future() })) },
    });
    prisma.$transaction = vi.fn(async () => {
      throw txError;
    });
    const gateway = { name: 'mock', createCharge: vi.fn() };
    const service = new DonationsService(prisma, new AuditService(prisma), { gateway } as any, {} as any);
    const detail = vi.spyOn(service, 'detail').mockResolvedValue({ id: 'don-1' } as any);
    return { service, gateway, detail };
  }

  it('request kalah dengan isi sama → replay detail donasi pemenang, bukan 500', async () => {
    const { service, gateway, detail } = setup({ id: 'don-1', donorId: owner.id, campaignId: 'camp-1', amount: 50_000 });
    await expect(service.create('camp-1', { amount: 50_000 }, KEY, owner, null)).resolves.toEqual({ id: 'don-1' });
    expect(detail).toHaveBeenCalledWith('don-1', owner);
    expect(gateway.createCharge).not.toHaveBeenCalled();
  });

  it('request kalah dengan isi berbeda → DONATION_DUPLICATE', async () => {
    const { service, gateway } = setup({ id: 'don-1', donorId: owner.id, campaignId: 'camp-1', amount: 75_000 });
    await expect(service.create('camp-1', { amount: 50_000 }, KEY, owner, null)).rejects.toThrowError(
      code('DONATION_DUPLICATE'),
    );
    expect(gateway.createCharge).not.toHaveBeenCalled();
  });

  it('error lain dari transaksi tetap diteruskan', async () => {
    const boom = new Error('db down');
    const { service } = setup(null, boom);
    await expect(service.create('camp-1', { amount: 50_000 }, KEY, owner, null)).rejects.toBe(boom);
  });
});
