import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token sesi stateless: `<userId>.<exp>.<sessionVersion>.<hmac>`. Diterbitkan setelah login berhasil
 * dan dikirim sebagai cookie httpOnly (BFD-11) atau header Bearer (Postman/script).
 * Revokasi: guard menolak token yang versinya != users.session_version (dinaikkan saat logout).
 * Token lama `<userId>.<exp>.<hmac>` (sebelum BFD-11) tetap valid dan dianggap versi 0.
 * Secret: SESSION_SECRET, atau diturunkan dari DATABASE_URL (sudah rahasia & ada di server).
 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export interface SessionClaims {
  userId: string;
  version: number;
}

function secret(): string {
  const base = process.env.SESSION_SECRET || process.env.DATABASE_URL || '';
  return createHash('sha256').update(`fundchain:session:${base}`).digest('hex');
}

function hmac(input: string): string {
  return createHmac('sha256', secret()).update(input).digest('hex');
}

/** Input tanda tangan dibedakan per format supaya token lama & baru tidak bisa saling ditukar. */
const signLegacy = (userId: string, exp: number) => hmac(`${userId}.${exp}`);
const signV2 = (userId: string, exp: number, version: number) => hmac(`v2:${userId}.${exp}.${version}`);

export function createSessionToken(userId: string, version = 0): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${userId}.${exp}.${version}.${signV2(userId, exp, version)}`;
}

/** Mengembalikan klaim bila token valid & belum kedaluwarsa. Token tanpa versi -> versi 0. */
export function verifySessionToken(token: string): SessionClaims | null {
  const parts = token.split('.');
  if (parts.length !== 3 && parts.length !== 4) return null;
  const legacy = parts.length === 3;
  const [userId, e] = parts;
  const v = legacy ? '0' : parts[2];
  const t = parts[parts.length - 1];

  const exp = Number(e);
  const version = Number(v);
  if (!userId || !/^[0-9a-f]{64}$/.test(t) || !Number.isInteger(exp) || exp < Date.now() / 1000) return null;
  if (!/^\d{1,9}$/.test(v) || !Number.isInteger(version)) return null;

  const expected = legacy ? signLegacy(userId, exp) : signV2(userId, exp, version);
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(t, 'hex')) ? { userId, version } : null;
}

/** Cookie sesi (BFD-11): httpOnly, SameSite=Lax, Path=/api; Secure di production/Vercel. */
export const SESSION_COOKIE = 'fc_session';

/** Header anti-CSRF wajib untuk request non-GET yang diautentikasi lewat cookie. */
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_HEADER_VALUE = 'fundchain';

export function sessionCookieOptions(productionLike: boolean) {
  return { httpOnly: true, secure: productionLike, sameSite: 'lax' as const, path: '/api' };
}

/** Ambil satu cookie dari header `Cookie` mentah (tanpa dependency cookie-parser). */
export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0 || part.slice(0, i).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(i + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}
