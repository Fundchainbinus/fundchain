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
import { env } from './env';
import { PrismaService } from './prisma.service';

/**
 * MODE DEMO TANPA LOGIN
 * ---------------------
 * Identitas diambil dari header `X-Acting-User: <userId>` yang dipilih lewat persona switcher di UI.
 * Role SELALU dibaca dari database, tidak pernah dari request (BR-AUTH-002).
 * Untuk produksi, ganti resolveUser() dengan verifikasi session dari Microsoft SSO.
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

@Injectable()
export class ActingUserGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    req.user = await this.resolveUser(req);

    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets);
    const roles = this.reflector.getAllAndOverride<Role[]>(ROLES, targets);

    if (isPublic && !roles) return true;
    if (!req.user) throw new AppError('AUTH_UNAUTHENTICATED', 'Pilih pengguna terlebih dahulu.');
    if (roles?.length && !roles.includes(req.user.role)) {
      throw new AppError('AUTH_FORBIDDEN', 'Anda tidak memiliki akses ke fitur ini.');
    }
    return true;
  }

  private async resolveUser(req: Request): Promise<CurrentUserPayload | undefined> {
    if (!env().demoMode) return undefined;
    const header = req.header('x-acting-user');
    if (!header || header.length > 64) return undefined;
    const user = await this.prisma.user.findUnique({ where: { id: header } });
    if (!user) return undefined;
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role as Role,
      integritySubjectId: user.integritySubjectId,
    };
  }
}
