import 'reflect-metadata';
import { createHash, createHmac } from 'node:crypto';
import type { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ActingUserGuard, Public } from './common/auth';
import { demoModeEnabled } from './common/env';
import type { PrismaService } from './common/prisma.service';
import { createSessionToken, readCookie, SESSION_TTL_SECONDS, verifySessionToken } from './common/session-token';
import { UsersController } from './modules/users/users.controller';

/** BFD-11 (cookie sesi + revokasi + CSRF) & BFD-12 (DEMO_MODE). Semua DB berupa fake. */

type FakeUser = { id: string; email: string; name: string; role: string; integritySubjectId: string; sessionVersion?: number };

const users: Record<string, FakeUser> = {};

function resetUsers() {
  for (const k of Object.keys(users)) delete users[k];
  users['u-student'] = { id: 'u-student', email: 'budi.santoso@binus.ac.id', name: 'Budi', role: 'STUDENT', integritySubjectId: 'STU-1', sessionVersion: 0 };
  users['u-admin'] = { id: 'u-admin', email: 'admin@binus.ac.id', name: 'Admin', role: 'ADMIN', integritySubjectId: 'ADM-1', sessionVersion: 0 };
}

const fakePrisma = {
  user: {
    findUnique: vi.fn(async ({ where }: { where: { id?: string; email?: string } }) =>
      where.id ? (users[where.id] ?? null) : (Object.values(users).find((u) => u.email === where.email) ?? null),
    ),
    update: vi.fn(async ({ where, data }: { where: { id: string }; data: { sessionVersion: { increment: number } } }) => {
      const u = users[where.id];
      u.sessionVersion = (u.sessionVersion ?? 0) + data.sessionVersion.increment;
      return u;
    }),
  },
};

const guard = new ActingUserGuard(new Reflector(), fakePrisma as unknown as PrismaService);

class Handlers {
  authed() {}

  @Public()
  webhook() {}
}

function ctx(handler: keyof Handlers, opts: { method?: string; headers?: Record<string, string> } = {}) {
  const headers = Object.fromEntries(Object.entries(opts.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  const req = { method: opts.method ?? 'GET', header: (name: string) => headers[name.toLowerCase()] } as Record<string, unknown>;
  const context = {
    getHandler: () => Handlers.prototype[handler],
    getClass: () => Handlers,
    switchToHttp: () => ({ getRequest: () => req }),
  } as unknown as ExecutionContext;
  return { context, req };
}

const cookie = (token: string) => ({ cookie: `other=1; fc_session=${encodeURIComponent(token)}` });
const CSRF = { 'X-Requested-With': 'fundchain' };

function fakeRes() {
  return { cookie: vi.fn(), clearCookie: vi.fn() };
}

const ENV_KEYS = ['NODE_ENV', 'VERCEL', 'DEMO_MODE', 'DEMO_MODE_ALLOW_PRODUCTION', 'SESSION_SECRET', 'GOOGLE_CLIENT_ID'] as const;
const savedEnv: Partial<Record<string, string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  delete process.env.VERCEL;
  delete process.env.DEMO_MODE;
  delete process.env.DEMO_MODE_ALLOW_PRODUCTION;
  process.env.NODE_ENV = 'test';
  process.env.SESSION_SECRET = 'test-session-secret';
  resetUsers();
  vi.clearAllMocks();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  vi.unstubAllGlobals();
});

/** Token format lama (sebelum BFD-11): `<userId>.<exp>.<hmac>` tanpa versi. */
function legacyToken(userId: string) {
  const secret = createHash('sha256').update(`fundchain:session:${process.env.SESSION_SECRET}`).digest('hex');
  const exp = Math.floor(Date.now() / 1000) + 3600;
  return `${userId}.${exp}.${createHmac('sha256', secret).update(`${userId}.${exp}`).digest('hex')}`;
}

describe('session token (BFD-11)', () => {
  it('menyematkan sessionVersion dan memverifikasinya', () => {
    expect(verifySessionToken(createSessionToken('u-1', 3))).toEqual({ userId: 'u-1', version: 3 });
  });

  it('token lama tanpa versi diterima sebagai versi 0', () => {
    expect(verifySessionToken(legacyToken('u-1'))).toEqual({ userId: 'u-1', version: 0 });
  });

  it('versi yang diubah merusak tanda tangan', () => {
    const [id, exp, , sig] = createSessionToken('u-1', 0).split('.');
    expect(verifySessionToken(`${id}.${exp}.1.${sig}`)).toBeNull();
    // Tanda tangan token lama tidak bisa dipakai ulang sebagai format baru.
    const [lid, lexp, lsig] = legacyToken('u-1').split('.');
    expect(verifySessionToken(`${lid}.${lexp}.0.${lsig}`)).toBeNull();
  });

  it('readCookie mengurai header Cookie', () => {
    expect(readCookie('a=1; fc_session=abc%2Edef; b=2', 'fc_session')).toBe('abc.def');
    expect(readCookie('a=1', 'fc_session')).toBeUndefined();
    expect(readCookie('fc_session=%E0%A4%A', 'fc_session')).toBeUndefined();
    expect(readCookie(undefined, 'fc_session')).toBeUndefined();
  });
});

describe('ActingUserGuard: cookie, Bearer, revokasi', () => {
  it('menerima cookie sesi', async () => {
    const { context, req } = ctx('authed', { headers: cookie(createSessionToken('u-student')) });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u-student' });
  });

  it('menerima Authorization: Bearer (Postman/script)', async () => {
    const { context, req } = ctx('authed', { headers: { authorization: `Bearer ${createSessionToken('u-admin')}` } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u-admin', role: 'ADMIN' });
  });

  it('cookie didahulukan daripada Bearer', async () => {
    const { context, req } = ctx('authed', {
      headers: { ...cookie(createSessionToken('u-student')), authorization: `Bearer ${createSessionToken('u-admin')}` },
    });
    await guard.canActivate(context);
    expect(req.user).toMatchObject({ id: 'u-student' });
  });

  it('menolak token dengan sessionVersion basi (401)', async () => {
    users['u-student'].sessionVersion = 2;
    for (const headers of [cookie(createSessionToken('u-student', 1)), { authorization: `Bearer ${createSessionToken('u-student', 1)}` }]) {
      await expect(guard.canActivate(ctx('authed', { headers }).context)).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED', status: 401 });
    }
    await expect(guard.canActivate(ctx('authed', { headers: cookie(createSessionToken('u-student', 2)) }).context)).resolves.toBe(true);
  });

  it('token lama tanpa versi = v0: lolos selama user belum logout, ditolak setelahnya', async () => {
    const token = legacyToken('u-student');
    await expect(guard.canActivate(ctx('authed', { headers: { authorization: `Bearer ${token}` } }).context)).resolves.toBe(true);
    users['u-student'].sessionVersion = 1;
    await expect(guard.canActivate(ctx('authed', { headers: { authorization: `Bearer ${token}` } }).context)).rejects.toMatchObject({
      code: 'AUTH_UNAUTHENTICATED',
    });
  });

  it('user lama tanpa field sessionVersion (fake/kolom default) dianggap 0', async () => {
    delete users['u-student'].sessionVersion;
    await expect(guard.canActivate(ctx('authed', { headers: cookie(createSessionToken('u-student')) }).context)).resolves.toBe(true);
  });

  it('cookie basi jatuh ke Bearer yang valid', async () => {
    users['u-student'].sessionVersion = 5;
    const { context, req } = ctx('authed', {
      headers: { ...cookie(createSessionToken('u-student', 0)), authorization: `Bearer ${createSessionToken('u-admin')}` },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u-admin' });
  });
});

describe('ActingUserGuard: CSRF untuk auth cookie', () => {
  it('POST via cookie tanpa X-Requested-With -> 403', async () => {
    const { context } = ctx('authed', { method: 'POST', headers: cookie(createSessionToken('u-student')) });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN', status: 403 });
  });

  it('POST via cookie dengan nilai header salah -> 403', async () => {
    const { context } = ctx('authed', {
      method: 'PATCH',
      headers: { ...cookie(createSessionToken('u-student')), 'X-Requested-With': 'XMLHttpRequest' },
    });
    await expect(guard.canActivate(context)).rejects.toMatchObject({ code: 'AUTH_FORBIDDEN' });
  });

  it('POST via cookie dengan X-Requested-With: fundchain -> lolos', async () => {
    const { context } = ctx('authed', { method: 'POST', headers: { ...cookie(createSessionToken('u-student')), ...CSRF } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('GET via cookie tidak butuh header CSRF', async () => {
    await expect(guard.canActivate(ctx('authed', { method: 'GET', headers: cookie(createSessionToken('u-student')) }).context)).resolves.toBe(true);
  });

  it('POST via Bearer tidak butuh header CSRF', async () => {
    const { context } = ctx('authed', { method: 'POST', headers: { authorization: `Bearer ${createSessionToken('u-student')}` } });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('web lama selama transisi: cookie + Bearer tanpa header CSRF -> lolos via Bearer', async () => {
    const { context, req } = ctx('authed', {
      method: 'POST',
      headers: { ...cookie(createSessionToken('u-student')), authorization: `Bearer ${createSessionToken('u-student')}` },
    });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toMatchObject({ id: 'u-student' });
  });

  it('@Public webhook: POST dengan/ tanpa cookie & tanpa header CSRF tetap lolos (anonim)', async () => {
    await expect(guard.canActivate(ctx('webhook', { method: 'POST' }).context)).resolves.toBe(true);
    const { context, req } = ctx('webhook', { method: 'POST', headers: cookie(createSessionToken('u-student')) });
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(req.user).toBeUndefined();
  });
});

describe('UsersController sesi cookie', () => {
  const audit = { log: vi.fn(async () => ({})) };
  const controller = () => new UsersController(fakePrisma as never, audit as never, {} as never, {} as never);

  function stubGoogle(email: string) {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => ({
        ok: true,
        json: async () =>
          url.includes('tokeninfo') ? { aud: 'client-id' } : { email, email_verified: true, name: 'Budi' },
      })),
    );
  }

  it('POST /auth/google memasang cookie httpOnly (dev: tanpa Secure) dan tetap mengembalikan token', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    users['u-student'].sessionVersion = 4;
    stubGoogle('budi.santoso@binus.ac.id');
    const res = fakeRes();
    const out = await controller().loginGoogle({ accessToken: 'google-access-token' }, res as never);
    expect(res.cookie).toHaveBeenCalledWith('fc_session', out.token, {
      httpOnly: true,
      secure: false,
      sameSite: 'lax',
      path: '/api',
      maxAge: SESSION_TTL_SECONDS * 1000,
    });
    expect(verifySessionToken(out.token)).toEqual({ userId: 'u-student', version: 4 });
  });

  it('POST /auth/google di production / Vercel -> cookie Secure', async () => {
    process.env.GOOGLE_CLIENT_ID = 'client-id';
    for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
      Object.assign(process.env, env);
      stubGoogle('budi.santoso@binus.ac.id');
      const res = fakeRes();
      await controller().loginGoogle({ accessToken: 'google-access-token' }, res as never);
      expect(res.cookie.mock.calls[0][2]).toMatchObject({ httpOnly: true, secure: true, sameSite: 'lax', path: '/api' });
      process.env.NODE_ENV = 'test';
      delete process.env.VERCEL;
    }
  });

  it('POST /auth/logout menaikkan sessionVersion, menghapus cookie, dan token lama tidak berlaku lagi', async () => {
    const token = createSessionToken('u-student', 0);
    const { context, req } = ctx('authed', { method: 'POST', headers: { ...cookie(token), ...CSRF } });
    await guard.canActivate(context);
    const res = fakeRes();
    await expect(controller().logout(req.user as never, '10.0.0.1', 'vitest', res as never)).resolves.toEqual({ loggedOut: true });

    expect(users['u-student'].sessionVersion).toBe(1);
    expect(res.clearCookie).toHaveBeenCalledWith('fc_session', { httpOnly: true, secure: false, sameSite: 'lax', path: '/api' });
    expect(audit.log).toHaveBeenCalledWith(expect.objectContaining({ action: 'AUTH_LOGOUT', actorId: 'u-student' }));
    await expect(guard.canActivate(ctx('authed', { headers: cookie(token) }).context)).rejects.toMatchObject({ code: 'AUTH_UNAUTHENTICATED' });
  });

  it('POST /auth/logout tanpa sesi valid hanya menghapus cookie', async () => {
    const res = fakeRes();
    await expect(controller().logout(undefined, null, null, res as never)).resolves.toEqual({ loggedOut: true });
    expect(fakePrisma.user.update).not.toHaveBeenCalled();
    expect(audit.log).not.toHaveBeenCalled();
    expect(res.clearCookie).toHaveBeenCalledOnce();
  });

  it('POST /auth/logout bersifat @Public (cookie basi tetap bisa dibersihkan)', () => {
    expect(Reflect.getMetadata('isPublic', UsersController.prototype.logout)).toBe(true);
  });
});

describe('DEMO_MODE (BFD-12)', () => {
  const audit = { log: vi.fn(async () => ({})) };
  const controller = () => new UsersController(fakePrisma as never, audit as never, {} as never, {} as never);

  it('demoModeEnabled: default mati; production butuh DEMO_MODE_ALLOW_PRODUCTION', () => {
    expect(demoModeEnabled({})).toBe(false);
    expect(demoModeEnabled({ DEMO_MODE: 'true', NODE_ENV: 'development' })).toBe(true);
    expect(demoModeEnabled({ DEMO_MODE: 'true', NODE_ENV: 'production' })).toBe(false);
    expect(demoModeEnabled({ DEMO_MODE: 'true', VERCEL: '1' })).toBe(false);
    expect(demoModeEnabled({ DEMO_MODE: 'true', VERCEL: '1', DEMO_MODE_ALLOW_PRODUCTION: 'true' })).toBe(true);
    expect(demoModeEnabled({ DEMO_MODE_ALLOW_PRODUCTION: 'true', NODE_ENV: 'production' })).toBe(false);
  });

  it('GET /auth/demo mati secara default -> 404 DEV_TOOLS_DISABLED, tanpa cookie', async () => {
    const res = fakeRes();
    await expect(controller().loginDemo('student', null, null, res as never)).rejects.toMatchObject({ code: 'DEV_TOOLS_DISABLED', status: 404 });
    // Persona tidak valid pun tetap 404 (gate dicek lebih dulu).
    await expect(controller().loginDemo('hacker', null, null, res as never)).rejects.toMatchObject({ code: 'DEV_TOOLS_DISABLED' });
    expect(res.cookie).not.toHaveBeenCalled();
  });

  it('mati di production walau DEMO_MODE=true', async () => {
    process.env.DEMO_MODE = 'true';
    for (const env of [{ NODE_ENV: 'production' }, { VERCEL: '1' }]) {
      Object.assign(process.env, env);
      const res = fakeRes();
      await expect(controller().loginDemo('admin', null, null, res as never)).rejects.toMatchObject({ code: 'DEV_TOOLS_DISABLED' });
      expect(res.cookie).not.toHaveBeenCalled();
      process.env.NODE_ENV = 'test';
      delete process.env.VERCEL;
    }
    expect(audit.log).not.toHaveBeenCalled();
  });

  it('aktif di dev: login persona seed, cookie sesi dipasang, dan diaudit', async () => {
    process.env.DEMO_MODE = 'true';
    const res = fakeRes();
    const out = await controller().loginDemo('admin', '10.0.0.9', 'vitest', res as never);
    expect(out.user).toMatchObject({ id: 'u-admin', role: 'ADMIN' });
    expect(out).not.toHaveProperty('token');
    const [name, token, opts] = res.cookie.mock.calls[0];
    expect(name).toBe('fc_session');
    expect(opts).toMatchObject({ httpOnly: true, sameSite: 'lax', path: '/api' });
    expect(verifySessionToken(token)).toEqual({ userId: 'u-admin', version: 0 });
    expect(audit.log).toHaveBeenCalledWith({
      actorId: 'u-admin',
      action: 'AUTH_DEMO_LOGIN',
      entityType: 'User',
      entityId: 'u-admin',
      metadata: { persona: 'admin' },
      ipAddress: '10.0.0.9',
      userAgent: 'vitest',
    });
  });

  it('persona tidak dikenal -> VALIDATION_ERROR; user seed hilang -> NOT_FOUND (tidak membuat user)', async () => {
    process.env.DEMO_MODE = 'true';
    await expect(controller().loginDemo('root', null, null, fakeRes() as never)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(controller().loginDemo(undefined, null, null, fakeRes() as never)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    delete users['u-student'];
    await expect(controller().loginDemo('student', null, null, fakeRes() as never)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    expect(audit.log).not.toHaveBeenCalled();
  });
});
