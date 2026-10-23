import { hashDonation } from '@fundchain/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Dependency diganti stub: test tidak menyentuh DB maupun RPC.
vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/audit/audit.service', () => ({ AuditService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('./modules/storage/storage.service', () => ({ StorageService: class {} }));

import { CampaignsService } from './modules/campaigns/campaigns.service';
import { IntegrityService } from './modules/integrity/integrity.service';

const SEPOLIA = 11155111;
const DONATED_AT = new Date('2026-10-20T03:00:00.000Z');
const SUBJECT = 'subject-1';

/** Hash asli yang tercatat di blockchain saat settlement (nominal Rp50.000). */
const ORIGINAL = hashDonation({ donationId: 'don-1', integritySubjectId: SUBJECT, amount: 50_000, donatedAt: DONATED_AT });

function makeDonation(over: Record<string, any> = {}) {
  return {
    id: 'don-1',
    campaignId: 'camp-1',
    amount: 50_000,
    status: 'PAID',
    donatedAt: DONATED_AT,
    hash: ORIGINAL.hash,
    integrityStatus: 'VERIFIED',
    lastCheckedAt: null as Date | null,
    updatedAt: new Date('2026-10-21T00:00:00.000Z'),
    donor: { integritySubjectId: SUBJECT },
    blockchain: {
      status: 'CONFIRMED',
      onchainKey: '0x' + 'aa'.repeat(32),
      txHash: '0x' + 'cc'.repeat(32),
      blockNumber: 101,
      chainId: SEPOLIA,
      network: 'sepolia',
      contractAddress: '0xC0FFEE',
      confirmedAt: new Date('2026-10-20T03:01:00.000Z'),
    },
    ...over,
  };
}

function setupIntegrity(donation = makeDonation()) {
  const prisma: any = {
    donation: {
      findUnique: vi.fn(async () => donation),
      findMany: vi.fn(async () => [{ id: donation.id }]),
      update: vi.fn(async ({ data }: any) => Object.assign(donation, data)),
      count: vi.fn(async () => 0),
    },
    $transaction: vi.fn(async (fn: any) => fn(prisma)),
  };
  const chain: any = {
    readOnchainHash: vi.fn(async () => ORIGINAL.hash),
    isZero: (h: string) => /^0x0+$/.test(h),
    target: () => ({ network: 'sepolia', chainId: SEPOLIA, contractAddress: '0xC0FFEE' }),
    explorerTx: (_chainId: number, tx: string | null) => (tx ? `https://sepolia.etherscan.io/tx/${tx}` : null),
  };
  const campaigns: any = { freeze: vi.fn(async () => ({ changed: true })) };
  const audit: any = { log: vi.fn(async () => undefined) };
  const service = new IntegrityService(prisma, chain, campaigns, audit);
  return { service, prisma, chain, campaigns, audit, donation };
}

describe('Gate 2: skenario tamper → checker → FROZEN', () => {
  it('nominal diubah di DB → TAMPERED, campaign dibekukan, jejak tercatat lengkap', async () => {
    const { service, campaigns, audit, donation } = setupIntegrity(makeDonation({ amount: 900_000 }));

    const r = await service.verifyDonation('don-1', 'admin-1', { ip: '10.0.0.7', userAgent: 'Mozilla/5.0 Demo', source: 'MANUAL' });

    expect(r.status).toBe('TAMPERED');
    expect(r.campaignFrozen).toBe(true);
    expect(donation.integrityStatus).toBe('TAMPERED');
    expect(campaigns.freeze).toHaveBeenCalledWith(expect.anything(), 'camp-1', expect.stringContaining('TAMPERED'), 'admin-1', '10.0.0.7', 'Mozilla/5.0 Demo');

    const entry = audit.log.mock.calls[0][0];
    expect(entry.action).toBe('INTEGRITY_TAMPERED');
    expect(entry.ipAddress).toBe('10.0.0.7');
    expect(entry.userAgent).toBe('Mozilla/5.0 Demo');
    expect(entry.metadata).toMatchObject({
      source: 'MANUAL',
      previousStatus: 'VERIFIED',
      firstDetection: true,
      storedHash: ORIGINAL.hash,
      onChainHash: ORIGINAL.hash,
      currentData: { amount: 900_000 },
    });
    expect(entry.metadata.currentHash).not.toBe(ORIGINAL.hash);
  });

  it('data asli → VERIFIED tanpa freeze', async () => {
    const { service, campaigns } = setupIntegrity();
    const r = await service.verifyDonation('don-1', null, { source: 'SCHEDULED' });
    expect(r.status).toBe('VERIFIED');
    expect(campaigns.freeze).not.toHaveBeenCalled();
  });

  it('data dipulihkan setelah tamper → kembali VERIFIED', async () => {
    const { service, audit } = setupIntegrity(makeDonation({ integrityStatus: 'TAMPERED' }));
    const r = await service.verifyDonation('don-1', 'admin-1', { source: 'DEMO' });
    expect(r.status).toBe('VERIFIED');
    expect(audit.log.mock.calls[0][0].metadata).toMatchObject({ previousStatus: 'TAMPERED', source: 'DEMO' });
  });
});

describe('hash checker otomatis', () => {
  beforeEach(() => {
    process.env.INTEGRITY_CHECK_INTERVAL_MS = String(60 * 60 * 1000);
    process.env.INTEGRITY_CHECK_BATCH = '25';
  });

  it('hanya mengambil donasi chain aktif yang belum dicek dalam interval, dibatasi batch', async () => {
    const { service, prisma } = setupIntegrity();
    const now = new Date('2026-10-23T12:00:00.000Z');

    await service.verifyStale(now);

    const query = prisma.donation.findMany.mock.calls[0][0];
    expect(query.take).toBe(25);
    expect(query.where.blockchain).toEqual({ status: 'CONFIRMED', chainId: SEPOLIA });
    expect(query.where.OR[1].lastCheckedAt.lt).toEqual(new Date('2026-10-23T11:00:00.000Z'));
  });

  it('mendeteksi tamper tanpa campur tangan admin', async () => {
    const { service, campaigns } = setupIntegrity(makeDonation({ amount: 1 }));
    const r = await service.verifyStale();
    expect(r).toMatchObject({ checked: 1, tampered: 1, verified: 0 });
    expect(campaigns.freeze).toHaveBeenCalledTimes(1);
  });

  it('hasil sama dengan sebelumnya tidak membanjiri audit log', async () => {
    const { service, audit, donation } = setupIntegrity();
    await service.verifyStale();
    expect(audit.log).not.toHaveBeenCalled();
    expect(donation.lastCheckedAt).toBeInstanceOf(Date);
  });

  it('RPC mati → berhenti dan dicoba lagi di putaran berikutnya', async () => {
    const { service, chain } = setupIntegrity();
    const { AppError } = await import('./common/app-error');
    chain.readOnchainHash.mockRejectedValueOnce(new AppError('BLOCKCHAIN_RPC_ERROR', 'down'));
    await expect(service.verifyStale()).rejects.toMatchObject({ code: 'BLOCKCHAIN_RPC_ERROR' });
  });
});

describe('Proof API', () => {
  it('mengembalikan hash DB, hash on-chain, txHash, timestamp, dan link Etherscan', async () => {
    const { service } = setupIntegrity();
    const p = await service.proof('don-1');
    expect(p).toMatchObject({
      hashDb: ORIGINAL.hash,
      currentHash: ORIGINAL.hash,
      hashOnChain: ORIGINAL.hash,
      match: true,
      txHash: '0x' + 'cc'.repeat(32),
      timestamp: new Date('2026-10-20T03:01:00.000Z'),
      etherscanUrl: `https://sepolia.etherscan.io/tx/0x${'cc'.repeat(32)}`,
    });
  });

  it('data dimanipulasi → match false, tanpa mengubah status integritas', async () => {
    const { service, prisma } = setupIntegrity(makeDonation({ amount: 900_000 }));
    const p = await service.proof('don-1');
    expect(p.match).toBe(false);
    expect(prisma.donation.update).not.toHaveBeenCalled();
  });

  it('belum ternotarisasi → hashOnChain null, tidak membaca RPC', async () => {
    const { service, chain } = setupIntegrity(makeDonation({ blockchain: { ...makeDonation().blockchain, status: 'QUEUED', txHash: null } }));
    const p = await service.proof('don-1');
    expect(p.hashOnChain).toBeNull();
    expect(p.match).toBeNull();
    expect(chain.readOnchainHash).not.toHaveBeenCalled();
  });
});

describe('auto-freeze & soft-delete campaign', () => {
  function setupCampaigns(campaign: Record<string, any>, tamperedCount = 0) {
    const campaigns = new Map([[campaign.id, campaign]]);
    const prisma: any = {
      campaign: {
        findUnique: vi.fn(async ({ where }: any) => campaigns.get(where.id) ?? null),
        findUniqueOrThrow: vi.fn(async ({ where }: any) => campaigns.get(where.id)),
        findMany: vi.fn(async ({ where }: any) =>
          [...campaigns.values()].filter(
            (c) => c.status === where.status && c.deletedAt === null && c.frozenAt && c.frozenAt <= where.frozenAt.lte,
          ),
        ),
        updateMany: vi.fn(async ({ where, data }: any) => {
          const c = campaigns.get(where.id);
          if (!c || c.status !== where.status || ('deletedAt' in where && c.deletedAt !== where.deletedAt)) return { count: 0 };
          Object.assign(c, data);
          return { count: 1 };
        }),
      },
      donation: { count: vi.fn(async () => tamperedCount) },
      $transaction: vi.fn(async (fn: any) => fn(prisma)),
    };
    const audit: any = { log: vi.fn(async () => undefined) };
    const service = new CampaignsService(prisma, audit, {} as any);
    return { service, audit, campaign };
  }

  const admin = { id: 'admin-1', role: 'ADMIN' } as any;

  beforeEach(() => {
    process.env.FROZEN_SOFT_DELETE_DAYS = '30';
  });

  it('freeze mencatat frozenAt dan User-Agent', async () => {
    const { service, audit, campaign } = setupCampaigns({ id: 'camp-1', status: 'ACTIVE', frozenAt: null, deletedAt: null });
    await service.freeze(service['prisma'], 'camp-1', 'tamper', null, '10.0.0.7', 'Mozilla/5.0');
    expect(campaign.status).toBe('FROZEN');
    expect(campaign.frozenAt).toBeInstanceOf(Date);
    expect(audit.log.mock.calls[0][0]).toMatchObject({ action: 'CAMPAIGN_FROZEN', userAgent: 'Mozilla/5.0' });
  });

  it('FROZEN > 30 hari disembunyikan (soft-delete), yang baru dibekukan tidak', async () => {
    const now = new Date('2026-12-01T00:00:00.000Z');
    const old = setupCampaigns({ id: 'camp-old', status: 'FROZEN', frozenAt: new Date('2026-10-01T00:00:00.000Z'), deletedAt: null });
    expect(await old.service.softDeleteFrozen(now)).toBe(1);
    expect(old.campaign.deletedAt).toEqual(now);
    expect(old.audit.log.mock.calls[0][0].action).toBe('CAMPAIGN_SOFT_DELETED');

    const fresh = setupCampaigns({ id: 'camp-new', status: 'FROZEN', frozenAt: new Date('2026-11-20T00:00:00.000Z'), deletedAt: null });
    expect(await fresh.service.softDeleteFrozen(now)).toBe(0);
    expect(fresh.campaign.deletedAt).toBeNull();
  });

  it('unfreeze ditolak selama masih ada donasi TAMPERED', async () => {
    const { service } = setupCampaigns(
      { id: 'camp-1', status: 'FROZEN', deadline: new Date('2099-01-01'), frozenAt: new Date(), deletedAt: null },
      2,
    );
    await expect(service.unfreeze('camp-1', admin, 'data sudah dipulihkan', null)).rejects.toMatchObject({ code: 'CAMPAIGN_FROZEN' });
  });

  it('unfreeze setelah data pulih membersihkan frozenAt & soft-delete', async () => {
    const { service, campaign } = setupCampaigns({
      id: 'camp-1',
      status: 'FROZEN',
      deadline: new Date('2099-01-01'),
      frozenAt: new Date('2026-10-01'),
      deletedAt: new Date('2026-11-01'),
    });
    await service.unfreeze('camp-1', admin, 'data sudah dipulihkan', null);
    expect(campaign).toMatchObject({ status: 'ACTIVE', frozenAt: null, deletedAt: null });
  });
});
