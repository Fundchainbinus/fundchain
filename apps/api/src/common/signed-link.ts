import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Link file bertanda tangan (berlaku singkat). Dipakai agar file yang butuh otorisasi
 * (proposal campaign non-publik) bisa dibuka di tab baru — tab baru tidak membawa header
 * identitas, jadi otorisasinya dibuktikan lewat tanda tangan di URL.
 *
 * Secret: FILE_URL_SECRET, atau diturunkan dari DATABASE_URL (sudah rahasia & ada di server).
 */
const TTL_SECONDS = 5 * 60;

function secret(): string {
  const base = process.env.FILE_URL_SECRET || process.env.DATABASE_URL || '';
  return createHash('sha256').update(`fundchain:file-link:${base}`).digest('hex');
}

function sign(resource: string, exp: number): string {
  return createHmac('sha256', secret()).update(`${resource}.${exp}`).digest('hex');
}

export function createSignedQuery(resource: string): string {
  const exp = Math.floor(Date.now() / 1000) + TTL_SECONDS;
  return `e=${exp}&t=${sign(resource, exp)}`;
}

export function verifySignedQuery(resource: string, e?: string, t?: string): boolean {
  const exp = Number(e);
  if (!t || !/^[0-9a-f]{64}$/.test(t) || !Number.isInteger(exp) || exp < Date.now() / 1000) return false;
  const expected = Buffer.from(sign(resource, exp), 'hex');
  return timingSafeEqual(expected, Buffer.from(t, 'hex'));
}
