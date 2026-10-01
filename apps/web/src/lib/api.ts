import axios, { AxiosError } from 'axios';
import { useSession } from './session';

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

export const api = axios.create({ baseURL: '/api/v1' });

api.interceptors.request.use((config) => {
  const id = useSession.getState().actingUserId;
  if (id) config.headers.set('X-Acting-User', id);
  return config;
});

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

/** Buka file yang butuh header identitas (mis. bukti pencairan) di tab baru. */
export async function openProtectedFile(url: string) {
  const res = (await api.get(url, { responseType: 'blob' })) as unknown as { data: Blob };
  const blobUrl = URL.createObjectURL(res.data);
  window.open(blobUrl, '_blank', 'noopener');
  setTimeout(() => URL.revokeObjectURL(blobUrl), 60_000);
}

export function errorMessage(e: unknown): string {
  return e instanceof Error ? e.message : 'Terjadi kesalahan.';
}
