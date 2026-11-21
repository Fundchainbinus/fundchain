import 'reflect-metadata';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { selectPaymentGateway } from './app.module';
import { ActingUserGuard, Public, Roles } from './common/auth';
import { apiDocsEnabled, insecureDefaultWarnings } from './common/env';
import type { PrismaService } from './common/prisma.service';
import { createSessionToken } from './common/session-token';
import { AuditService } from './modules/audit/audit.service';
import { MockPaymentAdapter } from './modules/payments/adapters/mock.adapter';
import { PakasirAdapter } from './modules/payments/adapters/pakasir.adapter';
import { UsersController } from './modules/users/users.controller';

class Handlers {
  @Roles('ADMIN')
  adminOnly() {}

  @Public()
  open() {}

  authed() {}
}

const users: Record<string, { id: string; email: string; name: string; role: string; integritySubjectId: string }> = {
  'u-student': { id: 'u-student', email: 's@x.id', name: 'Siswa', role: 'STUDENT', integritySubjectId: 'STU-1' },
  'u-admin': { id: 'u-admin', email: 'a@x.id', name: 'Admin', role: 'ADMIN', integritySubjectId: 'ADM-1' },
};

const fakePrisma = {
  user: { findUnique: vi.fn(async ({ where }: { where: { id: string } }) => users[where.id] ?? null) },
} as unknown as PrismaService;

const guard = new ActingUserGuard(new Reflector(), fakePrisma);

function ctx(handler: keyof Handlers, authorization?: string) {
  const req = { header: (name: string) => (name.toLowerCase() === 'authorization' ? authorization : undefined) } as Record<string, unknown>;
  const context = {
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

describe('ActingUserGuard', () => {
  beforeEach(() => {
    process.env.SESSION_SECRET = 'test-session-secret';
  });

  it('401 AUTH_UNAUTHENTICATED tanpa header Authorization', async () => {
    await expect(guard.canActivate(ctx('authed').context)).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED', status: 401 });
  });

  it('401 AUTH_UNAUTHENTICATED untuk token rusak / tanda tangan salah', async () => {
    const forged = createSessionToken('u-admin').replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    for (const token of ['garbage', 'u-admin.123.abc', forged]) {
      await expect(guard.canActivate(ctx('authed', `Bearer ${token}`).context)).rejects.toMatchObject({
        code: 'AUTH_UNAUTHENTICATED',
        status: 401,
      });
    }
  });

  it('401 untuk token yang ditandatangani secret lain', async () => {
    process.env.SESSION_SECRET = 'secret-lama';
    const token = createSessionToken('u-admin');
    process.env.SESSION_SECRET = 'secret-baru';
    await expect(guard.canActivate(ctx('authed', `Bearer ${token}`).context)).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });

  it('401 bila user di token sudah tidak ada di DB', async () => {
    const { context } = ctx('authed', `Bearer ${createSessionToken('u-hilang')}`);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });

  it('meneruskan token valid dan meng-attach user (role dari DB)', async () => {
    const { context, req } = ctx('authed', `Bearer ${createSessionToken('u-student')}`);
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u-student', role: 'STUDENT' });
  });

  it("@Roles('ADMIN') -> 403 AUTH_FORBIDDEN untuk STUDENT", async () => {
    const { context } = ctx('adminOnly', `Bearer ${createSessionToken('u-student')}`);
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN', status: 403 });
  });

  it("@Roles('ADMIN') -> lolos untuk ADMIN, 401 tanpa token", async () => {
    await expect(guard.canActivate(ctx('adminOnly', `Bearer ${createSessionToken('u-admin')}`).context)).resolves.toBe(true);
    await expect(guard.canActivate(ctx('adminOnly').context)).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });

  it('@Public() lolos tanpa token', async () => {
    await expect(guard.canActivate(ctx('open').context)).resolves.toBe(true);
  });
});

describe('UsersController auth endpoints', () => {
  it('POST /auth/logout mencatat AUTH_LOGOUT di audit log', async () => {
    const audit = { log: vi.fn(async () => ({})) };
    const controller = new UsersController({} as never, audit as never, {} as never, {} as never);
    const user = { id: 'u-student', email: 's@x.id', name: 'Siswa', role: 'STUDENT' as const, integritySubjectId: 'STU-1' };
    await expect(controller.logout(user, '10.0.0.1', 'vitest')).resolves.toEqual({ loggedOut: true });
    expect(audit.log).toHaveBeenCalledWith({
      actorId: 'u-student',
      action: 'AUTH_LOGOUT',
      entityType: 'User',
      entityId: 'u-student',
      ipAddress: '10.0.0.1',
      userAgent: 'vitest',
    });
  });

  it('GET /auth/me dan /me memakai handler yang sama', () => {
    expect(Reflect.getMetadata('path', UsersController.prototype.me)).toEqual(['auth/me', 'me']);
  });

  it('POST /auth/google punya throttle khusus 10/menit', () => {
    const fn = UsersController.prototype.loginGoogle;
    const keys = Reflect.getMetadataKeys(fn) as string[];
    const limitKey = keys.find((k) => String(k).includes('LIMIT') && String(k).endsWith('default'));
    const ttlKey = keys.find((k) => String(k).includes('TTL') && String(k).endsWith('default'));
    expect(limitKey && Reflect.getMetadata(limitKey, fn)).toBe(10);
    expect(ttlKey && Reflect.getMetadata(ttlKey, fn)).toBe(60_000);
  });
});

describe('selectPaymentGateway (PAYMENT_PROVIDER)', () => {
  const original = process.env.PAYMENT_PROVIDER;
  afterEach(() => {
    if (original === undefined) delete process.env.PAYMENT_PROVIDER;
    else process.env.PAYMENT_PROVIDER = original;
  });

  it('pakasir -> PakasirAdapter, mock -> MockPaymentAdapter', () => {
    expect(selectPaymentGateway('pakasir')).toBeInstanceOf(PakasirAdapter);
    expect(selectPaymentGateway('mock')).toBeInstanceOf(MockPaymentAdapter);
  });

  it('membaca env PAYMENT_PROVIDER; default / nilai asing -> mock', () => {
    process.env.PAYMENT_PROVIDER = 'pakasir';
    expect(selectPaymentGateway()).toBeInstanceOf(PakasirAdapter);
    process.env.PAYMENT_PROVIDER = 'mock';
    expect(selectPaymentGateway()).toBeInstanceOf(MockPaymentAdapter);
    delete process.env.PAYMENT_PROVIDER;
    expect(selectPaymentGateway()).toBeInstanceOf(MockPaymentAdapter);
    expect(selectPaymentGateway('midtrans')).toBeInstanceOf(MockPaymentAdapter);
  });
});

describe('AuditService.list filter', () => {
  const findMany = vi.fn(async (_args: unknown) => [] as unknown[]);
  const service = new AuditService({ auditLog: { findMany } } as unknown as PrismaService);
  const lastWhere = () => (findMany.mock.calls.at(-1)![0] as { where: Record<string, unknown> }).where;

  beforeEach(() => findMany.mockClear());

  it('membangun where untuk actorId, action, from, to', async () => {
    await service.list({ actorId: 'u-1', action: 'logout', from: '2026-01-01T00:00:00Z', to: '2026-02-01T00:00:00Z' });
    expect(lastWhere()).toEqual({
      actorId: 'u-1',
      entityType: undefined,
      entityId: undefined,
      action: { contains: 'logout', mode: 'insensitive' },
      createdAt: { gte: new Date('2026-01-01T00:00:00Z'), lte: new Date('2026-02-01T00:00:00Z') },
    });
  });

  it('filter kosong tidak membatasi apa pun', async () => {
    await service.list({ actorId: '', action: '' });
    expect(lastWhere()).toEqual({
      actorId: undefined,
      entityType: undefined,
      entityId: undefined,
      action: undefined,
      createdAt: { gte: undefined, lte: undefined },
    });
  });

  it('hanya from -> gte saja; limit dijepit ke 1..200 (+1 untuk cek halaman berikut)', async () => {
    await service.list({ from: '2026-03-01', limit: 999 });
    const args = findMany.mock.calls.at(-1)![0] as { where: { createdAt: unknown }; take: number };
    expect(args.where.createdAt).toEqual({ gte: new Date('2026-03-01'), lte: undefined });
    expect(args.take).toBe(201);
  });
});

describe('insecureDefaultWarnings (BFD-25)', () => {
  it('diam di development', () => {
    expect(insecureDefaultWarnings({ NODE_ENV: 'development' })).toEqual([]);
  });

  it('memperingatkan kedua secret default di production / Vercel', () => {
    expect(insecureDefaultWarnings({ NODE_ENV: 'production' })).toHaveLength(2);
    const vercel = insecureDefaultWarnings({ VERCEL: '1' });
    expect(vercel.join(' ')).toContain('SESSION_SECRET');
    expect(vercel.join(' ')).toContain('MOCK_WEBHOOK_SECRET');
  });

  it('tidak memperingatkan bila secret sudah di-set', () => {
    expect(insecureDefaultWarnings({ NODE_ENV: 'production', SESSION_SECRET: 's', MOCK_WEBHOOK_SECRET: 'm' })).toEqual([]);
  });
});

describe('apiDocsEnabled (BFD-44)', () => {
  it('aktif di non-production, mati di production kecuali ENABLE_API_DOCS=true', () => {
    expect(apiDocsEnabled({ NODE_ENV: 'development' })).toBe(true);
    expect(apiDocsEnabled({})).toBe(true);
    expect(apiDocsEnabled({ NODE_ENV: 'production' })).toBe(false);
    expect(apiDocsEnabled({ NODE_ENV: 'production', ENABLE_API_DOCS: 'true' })).toBe(true);
  });
});
