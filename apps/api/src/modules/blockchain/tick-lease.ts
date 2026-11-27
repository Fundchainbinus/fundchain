import { randomUUID } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { PrismaService } from '../../common/prisma.service';

/** Kunci baris lease di tabel system_state (dibuat oleh migrasi 20261127000100_system_state). */
export const TICK_LEASE_KEY = 'cron_tick';
/**
 * Lama lease. Harus > durasi tick terpanjang yang wajar dan < maxDuration function Vercel (60 dtk), supaya lease
 * instance yang mati di tengah tick kedaluwarsa sendiri sebelum tick berikutnya dijadwalkan (5–10 menit).
 */
export const TICK_LEASE_MS = 55_000;

export interface TickReport {
  ok: boolean;
  totalMs: number;
  steps: Record<string, number>;
  source: string;
}

/**
 * BFD-127: kunci lintas instance untuk NotarizationWorker.tick().
 *
 * Guard `running` di worker hanya berlaku per instance. Di Vercel, cron + kick() dari request bisa menjalankan tick
 * di dua instance bersamaan. Lease ini memakai UPDATE bersyarat (bukan advisory lock), karena koneksi Prisma lewat
 * pooler Supabase tidak menjamin sesi Postgres yang sama antara lock dan unlock.
 *
 *   UPDATE system_state SET locked_until = now()+55s, lock_owner = <uuid>
 *   WHERE key = 'cron_tick' AND (locked_until IS NULL OR locked_until < now())
 *
 * Hanya satu instance yang mendapat count = 1. Instance lain melewatkan tick ini (tick berikutnya akan datang).
 */
export class TickLease {
  constructor(private readonly prisma: Pick<PrismaService, 'systemState'>) {}

  /** Mengembalikan owner id bila lease didapat, null bila tick lain masih berjalan. */
  async acquire(now = new Date()): Promise<string | null> {
    const owner = randomUUID();
    const res = await this.prisma.systemState.updateMany({
      where: { key: TICK_LEASE_KEY, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] },
      data: { lockedUntil: new Date(now.getTime() + TICK_LEASE_MS), lockOwner: owner },
    });
    if (res.count === 1) return owner;

    // Baris belum ada (DB lama tanpa seed migrasi): buat sekaligus pegang lease. Balapan create → P2002 → kalah.
    const row = await this.prisma.systemState.findUnique({ where: { key: TICK_LEASE_KEY }, select: { key: true } });
    if (row) return null;
    try {
      await this.prisma.systemState.create({
        data: { key: TICK_LEASE_KEY, lockedUntil: new Date(now.getTime() + TICK_LEASE_MS), lockOwner: owner },
      });
      return owner;
    } catch {
      return null;
    }
  }

  /** Lepas lease (hanya bila masih milik owner ini) dan simpan jejak tick untuk monitoring (BFD-128). */
  async release(owner: string, report: TickReport, now = new Date()): Promise<void> {
    await this.prisma.systemState.updateMany({
      where: { key: TICK_LEASE_KEY, lockOwner: owner },
      data: {
        lockedUntil: null,
        lockOwner: null,
        lastTickAt: now,
        lastTickMs: report.totalMs,
        lastTickOk: report.ok,
        lastTickSteps: report.steps as Prisma.InputJsonValue,
        lastTickSource: report.source,
      },
    });
  }
}

/** Ambang "tick berhenti" untuk health, dashboard admin, dan watchdog (BFD-128). */
export const TICK_STALE_MS = 30 * 60_000;

export interface TickStatus {
  lastTickAt: string | null;
  ageSeconds: number | null;
  lastTickMs: number | null;
  ok: boolean | null;
  source: string | null;
  stale: boolean;
}

export async function readTickStatus(prisma: Pick<PrismaService, 'systemState'>, now = new Date()): Promise<TickStatus> {
  const row = await prisma.systemState.findUnique({ where: { key: TICK_LEASE_KEY } });
  const at = row?.lastTickAt ?? null;
  const ageMs = at ? now.getTime() - at.getTime() : null;
  return {
    lastTickAt: at ? at.toISOString() : null,
    ageSeconds: ageMs === null ? null : Math.floor(ageMs / 1000),
    lastTickMs: row?.lastTickMs ?? null,
    ok: row?.lastTickOk ?? null,
    source: row?.lastTickSource ?? null,
    stale: ageMs === null || ageMs > TICK_STALE_MS,
  };
}
