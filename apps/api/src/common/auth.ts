import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Role } from '@fundchain/shared';
import type { Request } from 'express';
import { AppError } from './app-error';
import { PrismaService } from './prisma.service';
import { CSRF_HEADER, CSRF_HEADER_VALUE, readCookie, SESSION_COOKIE, verifySessionToken } from './session-token';

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Login Google (popup). Setelah login, API menerbitkan token sesi sebagai cookie httpOnly
 * `fc_session` (BFD-11); header `Authorization: Bearer <token>` tetap diterima untuk Postman/script.
 * Role SELALU dibaca dari database, tidak pernah dari request (BR-AUTH-002).
 */
export interface CurrentUserPayload {
  id: string;
  email: string;
  name: string;
  role: Role;
  integritySubjectId: string;
}

export type AuthedRequest = Request & { user?: CurrentUserPayload };

const IS_PUBLIC = 'isPublic';
const ROLES = 'roles';

/** Endpoint boleh diakses tanpa identitas (user tetap di-attach kalau header ada). */
export const Public = () => SetMetadata(IS_PUBLIC, true);
export const Roles = (...roles: Role[]) => SetMetadata(ROLES, roles);

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<AuthedRequest>().user;
});

export const ClientIp = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().ip ?? null;
});

/** User-Agent pemanggil, dipotong supaya audit log tidak bisa dibanjiri header panjang. */
export const ClientUserAgent = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest<Request>().get('user-agent')?.slice(0, 500) ?? null;
});

@Injectable()
export class ActingUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const { user, csrfBlocked } = await this.resolveUser(req);
    req.user = user;

    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);

    // Endpoint publik (webhook, cron, login) tidak pernah ditolak karena CSRF; cookie-nya saja yang diabaikan.
    if (isPublic && !roles) return true;
    if (!req.user && csrfBlocked) {
      throw new AppError('AUTH_FORBIDDEN', `Request berbasis cookie wajib menyertakan header X-Requested-With: ${CSRF_HEADER_VALUE}.`);
    }
    if (!req.user) throw new AppError('AUTH_UNAUTHENTICATED', 'Silakan login dengan Google terlebih dahulu.');
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new AppError('AUTH_FORBIDDEN', 'Anda tidak memiliki akses ke fitur ini.');
    }
    return true;
  }

  /**
   * Urutan (BFD-11): cookie sesi (bila valid & lolos CSRF), lalu `Authorization: Bearer`, lalu anonim.
   * Cookie yang basi/dicabut atau tanpa header CSRF jatuh ke Bearer, supaya web lama (kirim Bearer
   * tanpa X-Requested-With, tapi sudah menerima cookie) tetap jalan selama masa transisi.
   */
  private async resolveUser(req: Request): Promise<{ user?: CurrentUserPayload; csrfBlocked: boolean }> {
    let csrfBlocked = false;
    const cookieToken = readCookie(req.header('cookie'), SESSION_COOKIE);
    if (cookieToken) {
      const safeMethod = SAFE_METHODS.has((req.method ?? 'GET').toUpperCase());
      if (safeMethod || req.header(CSRF_HEADER) === CSRF_HEADER_VALUE) {
        const user = await this.userFromToken(cookieToken);
        if (user) return { user, csrfBlocked };
      } else {
        csrfBlocked = true;
      }
    }
    const match = /^Bearer (.+)$/.exec(req.header('authorization') ?? '');
    const user = match ? await this.userFromToken(match[1]) : undefined;
    return { user, csrfBlocked };
  }

  private async userFromToken(token: string): Promise<CurrentUserPayload | undefined> {
    if (token.length > 512) return undefined;
    const claims = verifySessionToken(token);
    if (!claims) return undefined;
    const user = await this.prisma.user.findUnique({ where: { id: claims.userId } });
    // Revokasi: logout menaikkan session_version sehingga semua token versi lama ditolak.
    if (!user || (user.sessionVersion ?? 0) !== claims.version) return undefined;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      integritySubjectId: user.integritySubjectId,
    };
  }
}
