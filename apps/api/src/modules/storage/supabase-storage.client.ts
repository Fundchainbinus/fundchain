import { Readable } from 'node:stream';
import type { ReadableStream as WebReadableStream } from 'node:stream/web';
import { AppError } from '../../common/app-error';
import type { SupabaseStorageConfig } from './storage.config';

type FetchFn = typeof fetch;

export interface ObjectHead {
  /** Byte awal objek (maks n byte yang diminta). */
  head: Uint8Array;
  /** Ukuran total objek (dari Content-Range / Content-Length), null bila tidak diketahui. */
  totalSize: number | null;
  /** Content-Type yang disimpan Supabase (dari header PUT browser). */
  contentType: string | null;
}

/** Path objek di-encode per segmen (key hanya berisi huruf/angka/uuid, tapi tetap aman). */
function encodePath(p: string): string {
  return p.split('/').map(encodeURIComponent).join('/');
}

/**
 * Klien minimal Supabase Storage REST API (tanpa @supabase/supabase-js) — memakai global fetch.
 * Semua endpoint di bawah `${SUPABASE_URL}/storage/v1`, otorisasi service role key (hanya di server).
 */
export class SupabaseStorageClient {
  private readonly base: string;

  constructor(
    private readonly cfg: SupabaseStorageConfig,
    private readonly fetchFn: FetchFn = (...args) => globalThis.fetch(...args),
  ) {
    this.base = `${cfg.url}/storage/v1`;
  }

  get bucket() {
    return this.cfg.bucket;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return { Authorization: `Bearer ${this.cfg.serviceRoleKey}`, apikey: this.cfg.serviceRoleKey, ...extra };
  }

  private objectPath(key: string) {
    return `${encodeURIComponent(this.cfg.bucket)}/${encodePath(key)}`;
  }

  private async call(url: string, init: RequestInit, what: string): Promise<Response> {
    let res: Response;
    try {
      res = await this.fetchFn(url, init);
    } catch {
      throw new AppError('STORAGE_PROVIDER_ERROR', `Penyimpanan file tidak dapat dihubungi (${what}).`);
    }
    if (!res.ok) {
      if (res.status === 404 || res.status === 400) {
        const body = (await res.text().catch(() => '')).toLowerCase();
        if (res.status === 404 || body.includes('not_found') || body.includes('not found')) {
          throw new AppError('NOT_FOUND', 'File tidak ditemukan di penyimpanan.');
        }
      }
      throw new AppError('STORAGE_PROVIDER_ERROR', `Penyimpanan file menolak permintaan (${what}, HTTP ${res.status}).`);
    }
    return res;
  }

  /**
   * Signed upload URL (berlaku 2 jam, ditetapkan Supabase). Tanpa x-upsert: PUT kedua ke path yang sama
   * ditolak, jadi objek tidak bisa ditukar setelah diverifikasi.
   */
  async createSignedUploadUrl(key: string): Promise<{ url: string; token: string | null }> {
    const res = await this.call(
      `${this.base}/object/upload/sign/${this.objectPath(key)}`,
      { method: 'POST', headers: this.headers({ 'Content-Type': 'application/json' }), body: '{}' },
      'signed upload URL',
    );
    const data = (await res.json()) as { url?: string };
    if (!data.url) throw new AppError('STORAGE_PROVIDER_ERROR', 'Respons signed upload URL tidak valid.');
    const url = new URL(this.base + data.url);
    return { url: url.toString(), token: url.searchParams.get('token') };
  }

  /** Signed download URL berumur pendek. `downloadName` → Supabase mengirim Content-Disposition attachment. */
  async createSignedDownloadUrl(key: string, expiresIn: number, downloadName?: string): Promise<string> {
    const res = await this.call(
      `${this.base}/object/sign/${this.objectPath(key)}`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ expiresIn }),
      },
      'signed download URL',
    );
    const data = (await res.json()) as { signedURL?: string; signedUrl?: string };
    const signed = data.signedURL ?? data.signedUrl;
    if (!signed) throw new AppError('STORAGE_PROVIDER_ERROR', 'Respons signed download URL tidak valid.');
    const url = new URL(this.base + signed);
    if (downloadName) url.searchParams.set('download', downloadName);
    return url.toString();
  }

  /** Ambil n byte pertama (Range) + ukuran total & content-type. Bila Range diabaikan, baca hanya n byte. */
  async readHead(key: string, n: number): Promise<ObjectHead> {
    const res = await this.call(
      `${this.base}/object/authenticated/${this.objectPath(key)}`,
      { method: 'GET', headers: this.headers({ Range: `bytes=0-${n - 1}` }) },
      'baca file',
    );
    const range = res.headers.get('content-range');
    const fromRange = range ? Number(range.split('/')[1]) : NaN;
    const length = Number(res.headers.get('content-length'));
    const totalSize = Number.isFinite(fromRange)
      ? fromRange
      : res.status === 200 && Number.isFinite(length) && res.headers.has('content-length')
        ? length
        : null;
    const head = await readFirstBytes(res, n);
    return { head, totalSize, contentType: res.headers.get('content-type') };
  }

  /** Upload dari server (jalur multipart ≤4MB saat driver=supabase). */
  async upload(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.call(
      `${this.base}/object/${this.objectPath(key)}`,
      {
        method: 'POST',
        headers: this.headers({ 'Content-Type': contentType, 'x-upsert': 'false' }),
        body: new Uint8Array(body),
      },
      'unggah file',
    );
  }

  async download(key: string): Promise<Readable> {
    const res = await this.call(
      `${this.base}/object/authenticated/${this.objectPath(key)}`,
      { method: 'GET', headers: this.headers() },
      'unduh file',
    );
    if (!res.body) return Readable.from(Buffer.alloc(0));
    return Readable.fromWeb(res.body as unknown as WebReadableStream<Uint8Array>);
  }

  async remove(keys: string[]): Promise<void> {
    await this.call(
      `${this.base}/object/${encodeURIComponent(this.cfg.bucket)}`,
      {
        method: 'DELETE',
        headers: this.headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: keys }),
      },
      'hapus file',
    );
  }
}

async function readFirstBytes(res: Response, n: number): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer()).slice(0, n);
  const reader = res.body.getReader();
  const out = new Uint8Array(n);
  let filled = 0;
  try {
    while (filled < n) {
      const { done, value } = await reader.read();
      if (done || !value) break;
      const take = Math.min(value.length, n - filled);
      out.set(value.subarray(0, take), filled);
      filled += take;
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  return out.slice(0, filled);
}
