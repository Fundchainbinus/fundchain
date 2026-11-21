import axios, { AxiosError } from 'axios';

export class ApiError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status: number,
    readonly details?: Record<string, string[]>,
  ) {
    super(message);
  }
}

/**
 * Sesi dibawa cookie httpOnly (BFD-11). Header X-Requested-With wajib untuk request non-GET
 * berbasis cookie (anti-CSRF); dikirim di semua request supaya sederhana.
 */
const CSRF_HEADERS = { 'X-Requested-With': 'fundchain' };

export const api = axios.create({ baseURL: '/api/v1', withCredentials: true, headers: CSRF_HEADERS });

api.interceptors.response.use(
  (res) => (res.config.responseType === 'blob' ? res : res.data?.data),
  (err: AxiosError<{ error?: { code: string; message: string; details?: Record<string, string[]> } }>) => {
    const e = err.response?.data?.error;
    return Promise.reject(
      new ApiError(
        e?.code ?? 'NETWORK_ERROR',
        e?.message ?? 'Tidak dapat terhubung ke server. Pastikan API berjalan.',
        err.response?.status ?? 0,
        e?.details,
      ),
    );
  },
);

/** Helper bertipe: interceptor sudah membuka envelope { success, data }. */
export const get = <T,>(url: string, params?: object) => api.get(url, { params }) as unknown as Promise<T>;
export const post = <T,>(url: string, body?: unknown, headers?: Record<string, string>) =>
  api.post(url, body, { headers }) as unknown as Promise<T>;
export const patch = <T,>(url: string, body?: unknown) => api.patch(url, body) as unknown as Promise<T>;

/**
 * Buka file (proposal, bukti pencairan) di tab baru lewat fetch (cookie sesi ikut terkirim),
 * lalu tampilkan sebagai blob URL. Tab dibuka lebih dulu secara sinkron agar tidak diblokir popup blocker.
 */
export async function openProtectedFile(url: string) {
  const tab = window.open('', '_blank');
  try {
    const res = await fetch(`/api/v1${url}`, { credentials: 'same-origin', headers: CSRF_HEADERS });
    if (!res.ok) {
      const body = await res.json().catch(() => null);
      throw new ApiError(body?.error?.code ?? 'NOT_FOUND', body?.error?.message ?? 'File tidak dapat dibuka.', res.status);
    }
    const blobUrl = URL.createObjectURL(await res.blob());
    if (tab) tab.location.href = blobUrl;
    else window.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
  } catch (e) {
    tab?.close();
    throw e;
  }
}

/**
 * Buka file lewat link bertanda tangan: server memeriksa hak akses (dengan header identitas)
 * lalu mengembalikan URL berumur 5 menit yang bisa dibuka tab biasa — nama file & viewer PDF normal.
 */
export async function openSignedFile(linkPath: string) {
  const tab = window.open('', '_blank');
  try {
    const { url } = await get<{ url: string }>(linkPath);
    if (tab) tab.location.href = url;
    else window.location.href = url;
  } catch (e) {
    tab?.close();
    throw e;
  }
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Terjadi kesalahan.';
}
