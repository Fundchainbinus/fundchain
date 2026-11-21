/**
 * BFD-41 / BFD-76 — guard performa & bug query:
 *  - setiap query hot path dibatasi (`take`) dan hanya memuat kolom yang dibutuhkan;
 *  - setiap @@index di schema.prisma punya CREATE INDEX dengan nama yang sama di salah satu migrasi
 *    (mencegah drift schema ↔ migrasi);
 *  - audit log list tidak 500 untuk `limit`/`from`/`to` yang tidak valid.
 * Tidak menyentuh DB maupun RPC.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('./modules/campaigns/campaigns.service', () => ({ CampaignsService: class {} }));
vi.mock('./modules/storage/storage.service', () => ({ StorageService: class {} }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }));

import { AUDIT_LIST_MAX, AuditService, clampAuditLimit } from './modules/audit/audit.service';
import { NotarizationWorker, RECOVER_BATCH } from './modules/blockchain/notarization.worker';
import { IntegrityService, VERIFY_MANY_MAX } from './modules/integrity/integrity.service';
import { PaymentsService } from './modules/payments/payments.service';

const PRISMA_DIR = join(__dirname, '..', 'prisma');
const SEPOLIA = 11155111;

// ---------------------------------------------------------------------------
// Schema ↔ migrasi: setiap @@index punya CREATE INDEX bernama sama.
// ---------------------------------------------------------------------------

function toSnake(s: string) {
  return s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

/** Nama index default Prisma: <tabel>_<kolom...>_idx (kolom = nama @map, atau nama field). */
function schemaIndexes(schema: string): { model: string; name: string }[] {
  const out: { model: string; name: string }[] = [];
  for (const m of schema.matchAll(/^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm)) {
    const [, model, body] = m;
    const table = /@@map\("([^"]+)"\)/.exec(body)?.[1] ?? model;
    const columns = new Map<string, string>();
    for (const line of body.split('\n')) {
      const field = /^\s*(\w+)\s+\w+/.exec(line);
      if (!field || line.trim().startsWith('@@') || line.trim().startsWith('//')) continue;
      columns.set(field[1], /@map\("([^"]+)"\)/.exec(line)?.[1] ?? field[1]);
    }
    for (const idx of body.matchAll(/@@index\(\[([^\]]+)\](?:,\s*map:\s*"([^"]+)")?\)/g)) {
      const fields = idx[1].split(',').map((f) => f.trim().replace(/\(.*\)$/, ''));
      const name = idx[2] ?? `${table}_${fields.map((f) => columns.get(f) ?? toSnake(f)).join('_')}_idx`;
      out.push({ model, name });
    }
  }
  return out;
}

function allMigrationSql(): string {
  const dir = join(PRISMA_DIR, 'migrations');
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      try {
        return readFileSync(join(dir, d.name, 'migration.sql'), 'utf8');
      } catch {
        return '';
      }
    })
    .join('\n');
}

describe('index schema.prisma ↔ migrasi', () => {
  const schema = readFileSync(join(PRISMA_DIR, 'schema.prisma'), 'utf8');
  const indexes = schemaIndexes(schema);
  const sql = allMigrationSql();

  it('parser menemukan index hot path yang ditambahkan BFD-76', () => {
    const names = indexes.map((i) => i.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'payments_status_expires_at_idx',
        'donations_donor_id_created_at_idx',
        'donations_status_created_at_idx',
        'donations_status_last_checked_at_idx',
        'disbursements_status_requested_at_idx',
        'audit_logs_actor_id_created_at_idx',
        'blockchain_transactions_status_next_attempt_at_idx',
      ]),
    );
  });

  it.each(indexes.map((i) => [i.model, i.name]))('%s: index %s dibuat di migrasi', (_model, name) => {
    expect(sql).toMatch(new RegExp(`CREATE\\s+INDEX\\s+(IF\\s+NOT\\s+EXISTS\\s+)?"${name}"`, 'i'));
  });
});

// ---------------------------------------------------------------------------
// Audit log list
// ---------------------------------------------------------------------------

function auditSetup() {
  const prisma: any = { auditLog: { findMany: vi.fn(async () => []) } };
  return { prisma, service: new AuditService(prisma) };
}

describe('AuditService.list', () => {
  it('limit bukan angka (NaN) jatuh ke default, bukan take: NaN', async () => {
    expect(clampAuditLimit(Number('abc'))).toBe(50);
    expect(clampAuditLimit(undefined)).toBe(50);
    expect(clampAuditLimit(0)).toBe(1);
    expect(clampAuditLimit(10_000)).toBe(AUDIT_LIST_MAX);
    expect(clampAuditLimit(12.7)).toBe(12);

    const { prisma, service } = auditSetup();
    await service.list({ limit: Number('abc') });
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(51);
  });

  it('take selalu dibatasi MAX + 1', async () => {
    const { prisma, service } = auditSetup();
    await service.list({ limit: 1_000_000 });
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(AUDIT_LIST_MAX + 1);
  });

  it('tanggal tidak valid → VALIDATION_ERROR (400) tanpa query ke DB', async () => {
    const { prisma, service } = auditSetup();
    await expect(service.list({ from: 'kemarin' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    await expect(service.list({ to: '2026-13-45' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(prisma.auditLog.findMany).not.toHaveBeenCalled();
  });

  it('filter actorId + rentang tanggal sesuai index audit_logs(actor_id, created_at)', async () => {
    const { prisma, service } = auditSetup();
    await service.list({ actorId: 'u1', from: '2026-11-01', to: '2026-11-21' });
    const q = prisma.auditLog.findMany.mock.calls[0][0];
    expect(q.where.actorId).toBe('u1');
    expect(q.where.createdAt.gte).toEqual(new Date('2026-11-01'));
    expect(q.where.createdAt.lte).toEqual(new Date('2026-11-21'));
    expect(q.orderBy[0]).toEqual({ createdAt: 'desc' });
    // Relasi aktor hanya kolom yang ditampilkan, bukan seluruh baris user (email).
    expect(q.include.actor.select).toEqual({ id: true, name: true, role: true });
  });

  it('campaignActivity dibatasi 50 baris', async () => {
    const { prisma, service } = auditSetup();
    await service.campaignActivity('c1');
    expect(prisma.auditLog.findMany.mock.calls[0][0].take).toBe(50);
  });
});

// ---------------------------------------------------------------------------
// Integrity checker
// ---------------------------------------------------------------------------

function integritySetup(rows: number) {
  const ids = Array.from({ length: rows }, (_, i) => ({ id: `don-${i}` }));
  const prisma: any = {
    donation: {
      findMany: vi.fn(async ({ take }: any) => ids.slice(0, take)),
      // Donasi belum ternotarisasi → verifyDonation melempar BLOCKCHAIN_NOT_NOTARIZED (tanpa RPC).
      findUnique: vi.fn(async ({ where }: any) => ({ id: where.id, status: 'PENDING', donatedAt: null, blockchain: null })),
      update: vi.fn(async () => undefined),
      count: vi.fn(async () => 0),
    },
  };
  const chain: any = { target: () => ({ chainId: SEPOLIA }) };
  const service = new IntegrityService(prisma, chain, {} as any, {} as any);
  return { prisma, service };
}

describe('IntegrityService.verifyMany', () => {
  it(`dibatasi ${VERIFY_MANY_MAX} donasi per panggilan, hasMore memberi tahu masih ada sisa`, async () => {
    const { prisma, service } = integritySetup(VERIFY_MANY_MAX + 30);
    const r = await service.verifyMany('admin-1');
    const q = prisma.donation.findMany.mock.calls[0][0];
    expect(q.take).toBe(VERIFY_MANY_MAX + 1);
    expect(q.select).toEqual({ id: true });
    // Paling lama tidak dicek duluan → panggilan berikutnya maju ke donasi lain.
    expect(q.orderBy[0]).toEqual({ lastCheckedAt: { sort: 'asc', nulls: 'first' } });
    expect(prisma.donation.findUnique).toHaveBeenCalledTimes(VERIFY_MANY_MAX);
    expect(r.hasMore).toBe(true);
    expect(r.errors).toHaveLength(VERIFY_MANY_MAX);
    // Donasi yang gagal dicek digeser ke belakang urutan.
    expect(prisma.donation.update).toHaveBeenCalledTimes(VERIFY_MANY_MAX);
  });

  it('hasMore false bila semua muat dalam satu panggilan', async () => {
    const { service } = integritySetup(3);
    const r = await service.verifyMany('admin-1', 'camp-1');
    expect(r.hasMore).toBe(false);
  });

  it('verifyDonation hanya memuat pseudonim donatur (bukan email/nama)', async () => {
    const { prisma, service } = integritySetup(1);
    await service.verifyDonation('don-0', null).catch(() => undefined);
    expect(prisma.donation.findUnique.mock.calls[0][0].include.donor).toEqual({ select: { integritySubjectId: true } });
  });
});

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

describe('PaymentsService query', () => {
  function paymentsSetup() {
    const prisma: any = {
      payment: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    };
    const gateway: any = { name: 'mock' };
    const service = new PaymentsService(prisma, { log: vi.fn() } as any, {} as any, gateway);
    return { prisma, service };
  }

  it('expireStale memakai bentuk query index payments(status, expires_at) dan dibatasi 100', async () => {
    const { prisma, service } = paymentsSetup();
    await service.expireStale();
    const q = prisma.payment.findMany.mock.calls[0][0];
    expect(q.where.status).toBe('PENDING');
    expect(q.where.expiresAt.lt).toBeInstanceOf(Date);
    expect(q.orderBy).toEqual({ expiresAt: 'asc' });
    expect(q.take).toBe(100);
    expect(q.select).toEqual({ donationId: true, amount: true });
  });

  it('applyEvent hanya memuat pseudonim donatur', async () => {
    const { prisma, service } = paymentsSetup();
    await service
      .applyEvent({ orderId: 'd1', externalId: null, status: 'SETTLED', amount: 1, method: 'QRIS', raw: null })
      .catch(() => undefined);
    expect(prisma.payment.findUnique.mock.calls[0][0].include.donation.include.donor).toEqual({
      select: { integritySubjectId: true },
    });
  });
});

// ---------------------------------------------------------------------------
// Notarization worker scans
// ---------------------------------------------------------------------------

describe('NotarizationWorker scan', () => {
  function workerSetup() {
    const prisma: any = {
      blockchainTransaction: { findMany: vi.fn(async () => []) },
      auditLog: { findMany: vi.fn(async () => []) },
    };
    const chain: any = { target: () => ({ chainId: SEPOLIA, network: 'sepolia', contractAddress: '0xC0FFEE' }) };
    const audit: any = { log: vi.fn(async () => undefined) };
    const worker = new NotarizationWorker(prisma, chain, {} as any, {} as any, {} as any, audit);
    return { prisma, worker };
  }

  it(`recoverStuck membatasi kedua scan SUBMITTED ke ${RECOVER_BATCH} baris, terlama dulu`, async () => {
    const { prisma, worker } = workerSetup();
    await (worker as any).recoverStuck();
    expect(prisma.blockchainTransaction.findMany).toHaveBeenCalledTimes(2);
    for (const [q] of prisma.blockchainTransaction.findMany.mock.calls) {
      expect(q.take).toBe(RECOVER_BATCH);
      expect(q.orderBy).toEqual({ submittedAt: 'asc' });
      expect(q.where.status).toBe('SUBMITTED');
    }
  });

  it('alertStuck mencari alert lama lewat (entity_type, entity_id) agar memakai index', async () => {
    const { prisma, worker } = workerSetup();
    const old = new Date(Date.now() - 24 * 60 * 60_000);
    prisma.blockchainTransaction.findMany.mockResolvedValueOnce([
      { id: 'j1', donationId: 'don-1', status: 'QUEUED', createdAt: old, txHash: null, retryCount: 0, lastError: null },
    ]);
    prisma.auditLog.findMany.mockResolvedValueOnce([{ entityId: 'don-1' }]); // sudah pernah di-alert
    await (worker as any).alertStuck();
    const jobsQuery = prisma.blockchainTransaction.findMany.mock.calls[0][0];
    expect(jobsQuery.take).toBe(20);
    const q = prisma.auditLog.findMany.mock.calls[0][0];
    expect(q.where).toEqual({ action: 'BLOCKCHAIN_TX_STUCK', entityType: 'Donation', entityId: { in: ['don-1'] } });
    expect(q.select).toEqual({ entityId: true });
  });
});
