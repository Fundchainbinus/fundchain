import { LIMITS } from '@fundchain/shared';

export type StorageDriverName = 'db' | 'supabase';

export interface SupabaseStorageConfig {
  url: string;
  serviceRoleKey: string;
  bucket: string;
}

export interface StorageConfig {
  /** Driver efektif (setelah fallback). */
  driver: StorageDriverName;
  /** Driver yang diminta lewat STORAGE_DRIVER. */
  requested: string;
  supabase: SupabaseStorageConfig | null;
  /** Pesan kesalahan konfigurasi (driver diminta tapi env kurang / nilai tidak dikenal). */
  error: string | null;
}

export const DEFAULT_BUCKET = 'fundchain-files';

/**
 * Pilih driver penyimpanan dari env (BFD-42). Default 'db' (bytea di Postgres) supaya tidak ada yang
 * berubah sebelum env di-set. STORAGE_DRIVER=supabase butuh SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY;
 * bila kurang → error dicatat dan jatuh kembali ke 'db'. Hanya cek keberadaan env (tanpa ping jaringan).
 */
export function resolveStorageConfig(e: NodeJS.ProcessEnv = process.env): StorageConfig {
  const requested = (e.STORAGE_DRIVER || 'db').trim().toLowerCase();
  if (requested === 'db') return { driver: 'db', requested, supabase: null, error: null };
  if (requested !== 'supabase') {
    return { driver: 'db', requested, supabase: null, error: `STORAGE_DRIVER="${requested}" tidak dikenal (db | supabase); memakai db.` };
  }
  const url = (e.SUPABASE_URL || '').trim().replace(/\/+$/, '');
  const serviceRoleKey = (e.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  const bucket = (e.SUPABASE_STORAGE_BUCKET || DEFAULT_BUCKET).trim();
  const missing = [!url && 'SUPABASE_URL', !serviceRoleKey && 'SUPABASE_SERVICE_ROLE_KEY'].filter(Boolean);
  if (missing.length) {
    return {
      driver: 'db',
      requested,
      supabase: null,
      error: `STORAGE_DRIVER=supabase tetapi ${missing.join(', ')} kosong; memakai db (upload maks 4MB).`,
    };
  }
  return { driver: 'supabase', requested, supabase: { url, serviceRoleKey, bucket }, error: null };
}

/** Batas ukuran yang berlaku untuk web: direct upload 10MB (supabase), multipart 4MB (db). */
export function maxBytesFor(driver: StorageDriverName): number {
  return driver === 'supabase' ? LIMITS.FILE_MAX_BYTES_DIRECT : LIMITS.FILE_MAX_BYTES;
}
