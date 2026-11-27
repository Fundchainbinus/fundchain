/**
 * BFD-127 — cron tick aman dijalankan paralel lintas instance (lease di system_state).
 * BFD-128 — jejak tick terakhir untuk health / dashboard admin / watchdog.
 * Prisma palsu meniru semantik UPDATE bersyarat Postgres: satu baris, satu pemenang.
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('./common/prisma.service', () => ({ PrismaService: class {} }));
vi.mock('./modules/audit/audit.service', () => ({ AuditService: class {} }));
vi.mock('./modules/campaigns/campaigns.service', () => ({ CampaignsService: class {} }));
vi.mock('./modules/integrity/integrity.service', () => ({ IntegrityService: class {} }));
vi.mock('./modules/payments/payments.service', () => ({ PaymentsService: class {} }));
vi.mock('./modules/blockchain/blockchain.service', () => ({ BlockchainService: class {} }));
vi.mock('@vercel/functions', () => ({ waitUntil: () => undefined }));

import { NotarizationWorker } from './modules/blockchain/notarization.worker';
import { TICK_LEASE_KEY, TICK_LEASE_MS, TICK_STALE_MS, TickLease, readTickStatus } from './modules/blockchain/tick-lease';

type Row = Record<string, any> & { key: string };

function fakeSystemState(seed = true) {
  const rows = new Map<string, Row>();
  if (seed) rows.set(TICK_LEASE_KEY, { key: TICK_LEASE_KEY, lockedUntil: null, lockOwner: null });
  const match = (row: Row, where: any) => {
    if (where.key !== row.key) return false;
    if ('lockOwner' in where && row.lockOwner !== where.lockOwner) return false;
    if (where.OR) {
      return where.OR.some((c: any) =>
        c.lockedUntil === null ? row.lockedUntil == null : row.lockedUntil != null && row.lockedUntil < c.lockedUntil.lt,
      );
    }
    return true;
  };
  const systemState = {
    rows,
    // Sinkron di dalam: dua panggilan "bersamaan" tetap diserialisasi seperti row lock Postgres.
    updateMany: vi.fn(async ({ where, data }: any) => {
      let count = 0;
      for (const row of rows.values()) {
        if (match(row, where)) {
          Object.assign(row, data);
          count++;
        }
      }
      return { count };
    }),
    findUnique: vi.fn(async ({ where }: any) => rows.get(where.key) ?? null),
    create: vi.fn(async ({ data }: any) => {
      if (rows.has(data.key)) throw Object.assign(new Error('Unique constraint'), { code: 'P2002' });
      rows.set(data.key, { ...data });
      return data;
    }),
  };
  return systemState;
}

describe('TickLease (BFD-127)', () => {
  it('dua instance berebut lease bersamaan: tepat satu menang', async () => {
    const systemState = fakeSystemState();
    const a = new TickLease({ systemState } as any);
    const b = new TickLease({ systemState } as any);
    const [ownerA, ownerB] = await Promise.all([a.acquire(), b.acquire()]);
    expect([ownerA, ownerB].filter(Boolean)).toHaveLength(1);
  });

  it('lease yang kedaluwarsa (instance mati di tengah tick) bisa diambil lagi', async () => {
    const systemState = fakeSystemState();
    const lease = new TickLease({ systemState } as any);
    const t0 = new Date('2026-11-27T10:00:00Z');
    expect(await lease.acquire(t0)).toBeTruthy();
    expect(await lease.acquire(new Date(t0.getTime() + TICK_LEASE_MS - 1))).toBeNull();
    expect(await lease.acquire(new Date(t0.getTime() + TICK_LEASE_MS + 1))).toBeTruthy();
  });

  it('release hanya melepas lease milik sendiri dan menyimpan jejak tick', async () => {
    const systemState = fakeSystemState();
    const lease = new TickLease({ systemState } as any);
    const t0 = new Date('2026-11-27T10:00:00Z');
    const owner = (await lease.acquire(t0))!;
    await lease.release('orang-lain', { ok: true, totalMs: 1, steps: {}, source: 'cron' });
    expect(systemState.rows.get(TICK_LEASE_KEY)!.lockOwner).toBe(owner);

    const done = new Date(t0.getTime() + 1200);
    await lease.release(owner, { ok: true, totalMs: 1200, steps: { housekeeping: 200, notarize: 1000 }, source: 'cron' }, done);
    const row = systemState.rows.get(TICK_LEASE_KEY)!;
    expect(row).toMatchObject({ lockOwner: null, lockedUntil: null, lastTickAt: done, lastTickMs: 1200, lastTickOk: true, lastTickSource: 'cron' });
    expect(await lease.acquire(done)).toBeTruthy();
  });

  it('baris lease belum ada: dibuat sekali, pembuat kedua kalah tanpa error', async () => {
    const systemState = fakeSystemState(false);
    const a = new TickLease({ systemState } as any);
    const b = new TickLease({ systemState } as any);
    expect(await a.acquire()).toBeTruthy();
    expect(await b.acquire()).toBeNull();
  });
});

describe('NotarizationWorker.tick dengan lease (BFD-127)', () => {
  function makeWorker(systemState: any) {
    const health = vi.fn(async () => ({ ready: false, reason: 'RPC mati' }));
    const prisma: any = { systemState, blockchainTransaction: { findMany: vi.fn(async () => []) }, auditLog: { findMany: vi.fn(async () => []) } };
    const chain: any = { health, target: () => ({ chainId: 11155111, network: 'sepolia', contractAddress: '0x1' }) };
    const payments: any = { expireStale: vi.fn(async () => 0) };
    const campaigns: any = { completeExpired: vi.fn(async () => 0), softDeleteFrozen: vi.fn(async () => 0) };
    const worker = new NotarizationWorker(prisma, chain, {} as any, campaigns, payments, {} as any);
    return { worker, health, payments };
  }

  it('instance kedua melewatkan tick selama lease dipegang instance pertama', async () => {
    const systemState = fakeSystemState();
    const first = makeWorker(systemState);
    const second = makeWorker(systemState);
    // Instance pertama sedang di tengah tick: lease dipegang.
    const held = await new TickLease({ systemState } as any).acquire();
    expect(held).toBeTruthy();

    const res = await second.worker.tick('cron');
    expect(res).toEqual({ ran: false });
    expect(second.payments.expireStale).not.toHaveBeenCalled();
    expect(second.health).not.toHaveBeenCalled();
    expect(first.payments.expireStale).not.toHaveBeenCalled();
  });

  it('tick yang berjalan menyimpan durasi per langkah dan melepas lease', async () => {
    const systemState = fakeSystemState();
    const { worker, payments } = makeWorker(systemState);
    const res = await worker.tick('cron');
    expect(res.ran).toBe(true);
    expect(payments.expireStale).toHaveBeenCalledTimes(1);
    const row = systemState.rows.get(TICK_LEASE_KEY)!;
    expect(row.lockOwner).toBeNull();
    expect(row.lastTickSource).toBe('cron');
    expect(row.lastTickOk).toBe(true);
    expect(Object.keys(row.lastTickSteps)).toEqual(expect.arrayContaining(['housekeeping', 'alertStuck', 'health']));
    expect(typeof row.lastTickMs).toBe('number');
  });

  it('lease tidak tersedia (mis. tabel belum dimigrasi): fail-open, tick tetap jalan tanpa release', async () => {
    const systemState = fakeSystemState();
    systemState.updateMany.mockRejectedValueOnce(new Error('relation "system_state" does not exist'));
    const { worker, payments } = makeWorker(systemState);
    await expect(worker.tick('cron')).resolves.toEqual({ ran: true });
    expect(payments.expireStale).toHaveBeenCalledTimes(1);
    expect(systemState.updateMany).toHaveBeenCalledTimes(1); // tidak ada release
  });
});

describe('readTickStatus (BFD-128)', () => {
  it('belum pernah tick → stale', async () => {
    const systemState = fakeSystemState();
    expect(await readTickStatus({ systemState } as any)).toMatchObject({ lastTickAt: null, stale: true });
  });

  it('stale hanya bila tick terakhir lebih dari 30 menit lalu', async () => {
    const systemState = fakeSystemState();
    const at = new Date('2026-11-27T10:00:00Z');
    Object.assign(systemState.rows.get(TICK_LEASE_KEY)!, { lastTickAt: at, lastTickMs: 900, lastTickOk: true, lastTickSource: 'cron' });
    const fresh = await readTickStatus({ systemState } as any, new Date(at.getTime() + TICK_STALE_MS));
    expect(fresh).toMatchObject({ stale: false, ageSeconds: TICK_STALE_MS / 1000, lastTickMs: 900, source: 'cron' });
    const old = await readTickStatus({ systemState } as any, new Date(at.getTime() + TICK_STALE_MS + 1000));
    expect(old.stale).toBe(true);
  });
});
