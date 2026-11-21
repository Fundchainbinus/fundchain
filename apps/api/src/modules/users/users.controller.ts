import { randomBytes } from 'node:crypto';
import { Body, Controller, Get, HttpCode, Post, Query, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsString, MaxLength, MinLength } from 'class-validator';
import type { Response } from 'express';
import { AppError } from '../../common/app-error';
import { ClientIp, ClientUserAgent, CurrentUser, type CurrentUserPayload, Public, Roles } from '../../common/auth';
import { demoModeEnabled, env, isProductionLike } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';
import {
  createSessionToken,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  sessionCookieOptions,
} from '../../common/session-token';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { PaymentsService } from '../payments/payments.service';

class GoogleLoginDto {
  @IsString()
  @MinLength(10)
  @MaxLength(2048)
  accessToken!: string;
}

/** BFD-12: persona demo -> email user hasil prisma/seed.ts. */
const DEMO_PERSONAS = { student: 'budi.santoso@binus.ac.id', admin: 'admin@binus.ac.id' } as const;
type DemoPersona = keyof typeof DEMO_PERSONAS;

interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: string;
  integritySubjectId: string;
  sessionVersion?: number | null;
}

const publicUser = (u: SessionUser) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  integritySubjectId: u.integritySubjectId,
});

/** Terbitkan token sesi (versi sesi user saat ini) dan pasang sebagai cookie httpOnly. */
function startSession(res: Response, user: SessionUser): string {
  const token = createSessionToken(user.id, user.sessionVersion ?? 0);
  res.cookie(SESSION_COOKIE, token, { ...sessionCookieOptions(isProductionLike()), maxAge: SESSION_TTL_SECONDS * 1000 });
  return token;
}

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
      googleClientId: e.googleClientId,
      devTools: e.devTools,
      demoMode: demoModeEnabled(),
      paymentProvider: this.payments.gateway.name,
      chain: this.blockchain.target(),
    };
  }

  /**
   * Login Google (popup GIS): frontend mengirim access token Google, server memverifikasi
   * audience & email, membuat/menemukan user, lalu menerbitkan token sesi.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } }) // BFD-24: lebih ketat dari limit global (300/menit)
  @Post('auth/google')
  async loginGoogle(@Body() dto: GoogleLoginDto, @Res({ passthrough: true }) res: Response) {
    const cfg = env();
    if (!cfg.googleClientId) throw new AppError('AUTH_UNAUTHENTICATED', 'Login Google belum dikonfigurasi di server.');

    const q = encodeURIComponent(dto.accessToken);
    const [info, profile] = await Promise.all([
      fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${q}`),
      fetch('https://www.googleapis.com/oauth2/v3/userinfo', { headers: { Authorization: `Bearer ${dto.accessToken}` } }),
    ]);
    if (!info.ok || !profile.ok) throw new AppError('AUTH_UNAUTHENTICATED', 'Token Google tidak valid.');
    const tokenInfo = (await info.json()) as { aud?: string; azp?: string };
    const g = (await profile.json()) as { email?: string; email_verified?: boolean; name?: string };
    if ((tokenInfo.aud ?? tokenInfo.azp) !== cfg.googleClientId || !g.email || g.email_verified !== true) {
      throw new AppError('AUTH_UNAUTHENTICATED', 'Akun Google tidak dapat diverifikasi.');
    }

    const email = g.email.toLowerCase();
    const name = g.name?.trim() || email.split('@')[0];
    const existing = await this.prisma.user.findUnique({ where: { email } });
    const isAdmin = cfg.adminEmails.includes(email);
    const user = existing
      ? isAdmin && existing.role !== 'ADMIN'
        ? await this.prisma.user.update({ where: { id: existing.id }, data: { role: 'ADMIN' } })
        : existing
      : await this.prisma.user.create({
          data: {
            email,
            name,
            role: isAdmin ? 'ADMIN' : 'STUDENT',
            integritySubjectId: `${isAdmin ? 'ADM' : 'STU'}-${randomBytes(5).toString('hex').toUpperCase()}`,
          },
        });

    const token = startSession(res, user);
    // `token` di body hanya untuk masa transisi (web lama masih memakai Bearer). Web baru memakai cookie.
    return { token, user: publicUser(user) };
  }

  /**
   * BFD-12: login demo sebagai user hasil seed. Hanya aktif bila DEMO_MODE=true, dan di production
   * hanya bila DEMO_MODE_ALLOW_PRODUCTION=true juga di-set; selain itu 404 DEV_TOOLS_DISABLED.
   */
  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Get('auth/demo')
  async loginDemo(
    @Query('persona') persona: string | undefined,
    @ClientIp() ip: string | null,
    @ClientUserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Gate dicek lebih dulu supaya endpoint yang mati selalu 404 seragam, apa pun persona-nya.
    if (!demoModeEnabled()) throw new AppError('DEV_TOOLS_DISABLED', 'Mode demo tidak aktif.');
    if (persona !== 'student' && persona !== 'admin') throw new AppError('VALIDATION_ERROR', 'persona harus student atau admin.');
    const email = DEMO_PERSONAS[persona satisfies DemoPersona];
    // Tidak pernah membuat user: persona demo harus sudah ada dari seed.
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) throw new AppError('NOT_FOUND', 'User demo belum ada. Jalankan seed database terlebih dahulu.');

    startSession(res, user);
    await this.audit.log({
      actorId: user.id,
      action: 'AUTH_DEMO_LOGIN',
      entityType: 'User',
      entityId: user.id,
      metadata: { persona },
      ipAddress: ip,
      userAgent,
    });
    return { user: publicUser(user) };
  }

  /** Profil user yang sedang login. `/me` dipertahankan untuk kompatibilitas. */
  @Get(['auth/me', 'me'])
  me(@CurrentUser() user: CurrentUserPayload) {
    return user;
  }

  /**
   * Logout (BFD-11): menaikkan users.session_version sehingga SEMUA token sesi user ini (cookie
   * maupun Bearer, di semua perangkat) langsung ditolak, lalu menghapus cookie. Publik supaya
   * cookie basi tetap bisa dibersihkan; tanpa sesi valid hanya cookie yang dihapus.
   */
  @Public()
  @Post('auth/logout')
  @HttpCode(200)
  async logout(
    @CurrentUser() user: CurrentUserPayload | undefined,
    @ClientIp() ip: string | null,
    @ClientUserAgent() userAgent: string | null,
    @Res({ passthrough: true }) res: Response,
  ) {
    if (user) {
      await this.prisma.user.update({ where: { id: user.id }, data: { sessionVersion: { increment: 1 } } });
      await this.audit.log({ actorId: user.id, action: 'AUTH_LOGOUT', entityType: 'User', entityId: user.id, ipAddress: ip, userAgent });
    }
    res.clearCookie(SESSION_COOKIE, sessionCookieOptions(isProductionLike()));
    return { loggedOut: true };
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
