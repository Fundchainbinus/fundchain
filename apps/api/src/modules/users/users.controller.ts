import { Controller, Get, Query } from '@nestjs/common';
import { CurrentUser, type CurrentUserPayload, Public, Roles } from '../../common/auth';
import { env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentsService } from '../payments/payments.service';

@Controller()
export class UsersController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly blockchain: BlockchainService,
    private readonly payments: PaymentsService,
  ) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok', time: new Date().toISOString() };
  }

  /** Konfigurasi publik untuk frontend (tanpa secret). */
  @Public()
  @Get('config')
  config() {
    const e = env();
    return {
      demoMode: e.demoMode,
      devTools: e.devTools,
      paymentProvider: this.payments.gateway.name,
      chain: this.blockchain.target(),
    };
  }

  /** Daftar persona untuk mode demo tanpa login. */
  @Public()
  @Get('users')
  users() {
    if (!env().demoMode) return [];
    return this.prisma.user.findMany({
      select: { id: true, name: true, email: true, role: true, integritySubjectId: true },
      orderBy: [{ role: 'asc' }, { name: 'asc' }],
    });
  }

  @Get('me')
  me(@CurrentUser() user: CurrentUserPayload) {
    return user;
  }

  @Roles('ADMIN')
  @Get('admin/audit-logs')
  auditLogs(
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('limit') limit?: string,
    @Query('cursor') cursor?: string,
  ) {
    return this.audit.list({ actorId, entityType, entityId, action, from, to, limit: limit ? Number(limit) : undefined, cursor });
  }

  @Roles('ADMIN')
  @Get('admin/stats')
  async stats() {
    const [campaigns, donations, raised, blockchain, integrity, disbursements, chain] = await Promise.all([
      this.prisma.campaign.groupBy({ by: ['status'], _count: true }),
      this.prisma.donation.groupBy({ by: ['status'], _count: true }),
      this.prisma.donation.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
      this.prisma.blockchainTransaction.groupBy({ by: ['status'], _count: true }),
      this.prisma.donation.groupBy({ by: ['integrityStatus'], where: { status: 'PAID' }, _count: true }),
      this.prisma.disbursement.groupBy({ by: ['status'], _count: true, _sum: { amount: true } }),
      this.blockchain.info(),
    ]);
    const toMap = (rows: { _count: number }[], key: string) =>
      Object.fromEntries(rows.map((r) => [(r as unknown as Record<string, string>)[key], r._count]));
    return {
      campaigns: toMap(campaigns, 'status'),
      donations: toMap(donations, 'status'),
      totalRaised: raised._sum.amount ?? 0,
      blockchain: toMap(blockchain, 'status'),
      integrity: toMap(integrity, 'integrityStatus'),
      disbursements: Object.fromEntries(
        disbursements.map((d) => [d.status, { count: d._count, amount: d._sum.amount ?? 0 }]),
      ),
      chain,
    };
  }
}
