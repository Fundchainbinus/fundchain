import { Injectable } from '@nestjs/common';
import { AppError } from '../../common/app-error';
import { Db, PrismaService } from '../../common/prisma.service';

export const AUDIT_LIST_DEFAULT = 50;
export const AUDIT_LIST_MAX = 200;

/** `limit` dari query string: bukan angka (mis. `?limit=abc` → NaN) jatuh ke default, lalu dibatasi 1..MAX. */
export function clampAuditLimit(limit: number | undefined): number {
  const n = Number.isFinite(limit) ? Math.trunc(limit as number) : AUDIT_LIST_DEFAULT;
  return Math.min(Math.max(n, 1), AUDIT_LIST_MAX);
}

/** Tanggal filter dari query string. Tanggal tidak valid → 400, bukan Invalid Date yang membuat Prisma error (500). */
function parseDate(value: string | undefined, field: 'from' | 'to'): Date | undefined {
  if (!value) return undefined;
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new AppError('VALIDATION_ERROR', `Parameter ${field} bukan tanggal yang valid.`, { field });
  }
  return d;
}

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
  userAgent?: string | null;
}

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  /** Catat event kritis. Kirim `db` = client transaksi agar ikut atomic. */
  log(entry: AuditEntry, db: Db = this.prisma) {
    return db.auditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId ?? null,
        metadata: JSON.stringify(entry.metadata ?? {}),
        ipAddress: entry.ipAddress ?? null,
        userAgent: entry.userAgent ?? null,
      },
    });
  }

  async list(filter: {
    actorId?: string;
    entityType?: string;
    entityId?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
    cursor?: string;
  }) {
    const limit = clampAuditLimit(filter.limit);
    const from = parseDate(filter.from, 'from');
    const to = parseDate(filter.to, 'to');
    const logs = await this.prisma.auditLog.findMany({
      where: {
        actorId: filter.actorId || undefined,
        entityType: filter.entityType || undefined,
        entityId: filter.entityId || undefined,
        action: filter.action ? { contains: filter.action, mode: 'insensitive' } : undefined,
        createdAt: {
          gte: from,
          lte: to,
        },
      },
      include: { actor: { select: { id: true, name: true, role: true } } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
    });
    const hasMore = logs.length > limit;
    const page = logs.slice(0, limit);
    return {
      logs: page.map((l) => ({ ...l, metadata: safeParse(l.metadata) })),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /** Jejak publik untuk satu campaign (transparansi). */
  async campaignActivity(campaignId: string) {
    const logs = await this.prisma.auditLog.findMany({
      where: { entityType: 'Campaign', entityId: campaignId },
      include: { actor: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    return logs.map((l) => ({
      id: l.id,
      action: l.action,
      actor: l.actor ? { name: l.actor.name, role: l.actor.role } : { name: 'Sistem', role: 'SYSTEM' },
      metadata: safeParse(l.metadata),
      createdAt: l.createdAt,
    }));
  }
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return {};
  }
}
