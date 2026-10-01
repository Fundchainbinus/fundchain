import { Injectable } from '@nestjs/common';
import { Db, PrismaService } from '../../common/prisma.service';

export interface AuditEntry {
  actorId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: Record<string, unknown>;
  ipAddress?: string | null;
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
    const limit = Math.min(Math.max(filter.limit ?? 50, 1), 200);
    const logs = await this.prisma.auditLog.findMany({
      where: {
        actorId: filter.actorId || undefined,
        entityType: filter.entityType || undefined,
        entityId: filter.entityId || undefined,
        action: filter.action ? { contains: filter.action, mode: 'insensitive' } : undefined,
        createdAt: {
          gte: filter.from ? new Date(filter.from) : undefined,
          lte: filter.to ? new Date(filter.to) : undefined,
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
