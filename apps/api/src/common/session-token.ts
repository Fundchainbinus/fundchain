import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Token sesi stateless: `<userId>.<exp>.<hmac>`. Diterbitkan setelah login Google berhasil.
 * Secret: SESSION_SECRET, atau diturunkan dari DATABASE_URL (sudah rahasia & ada di server).
 */
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

function secret(): string {
  const base = process.env.SESSION_SECRET || process.env.DATABASE_URL || '';
  return createHash('sha256').update(`fundchain:session:${base}`).digest('hex');
}

function sign(userId: string, exp: number): string {
  return createHmac('sha256', secret()).update(`${userId}.${exp}`).digest('hex');
}

export function createSessionToken(userId: string): string {
  const exp = Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS;
  return `${userId}.${exp}.${sign(userId, exp)}`;
}

/** Mengembalikan userId bila token valid & belum kedaluwarsa. */
export function verifySessionToken(token: string): string | null {
  const [userId, e, t] = token.split('.');
  const exp = Number(e);
  if (!userId || !t || !/^[0-9a-f]{64}$/.test(t) || !Number.isInteger(exp) || exp < Date.now() / 1000) return null;
  return timingSafeEqual(Buffer.from(sign(userId, exp), 'hex'), Buffer.from(t, 'hex')) ? userId : null;
}
