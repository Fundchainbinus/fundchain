import { LIMITS } from '@fundchain/shared';
import { useQuery } from '@tanstack/react-query';
import { ApiError, api, get, post } from './api';

/** GET /files/config — driver penyimpanan aktif & batas ukuran upload (BFD-15). */
export interface FilesConfig {
  driver: 'db' | 'supabase';
  maxBytes: number;
  directUpload: boolean;
}

export type FilePurpose = 'campaign-document' | 'disbursement-proof';

interface UploadUrlResponse {
  fileId: string;
  uploadUrl: string;
  method: 'PUT';
  headers: Record<string, string>;
}

/** Fallback bila /files/config gagal: mode lama (multipart, 4MB) yang selalu didukung API. */
const LEGACY: FilesConfig = { driver: 'db', maxBytes: LIMITS.FILE_MAX_BYTES, directUpload: false };

export function useFilesConfig(): FilesConfig {
  const q = useQuery({
    queryKey: ['files-config'],
    queryFn: () => get<FilesConfig>('/files/config'),
    staleTime: 5 * 60_000,
    retry: 1,
  });
  return q.data ?? LEGACY;
}

export const maxSizeLabel = (bytes: number) => `${Math.round(bytes / (1024 * 1024))} MB`;

const MIME_BY_EXT: Record<string, string> = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
};

function contentTypeOf(file: File): string {
  if (file.type) return file.type;
  return MIME_BY_EXT[file.name.split('.').pop()?.toLowerCase() ?? ''] ?? 'application/octet-stream';
}

export function assertFileSize(file: File, cfg: FilesConfig) {
  if (file.size > cfg.maxBytes) {
    throw new ApiError('FILE_TOO_LARGE', `Ukuran file maksimal ${maxSizeLabel(cfg.maxBytes)}.`, 400);
  }
}

/**
 * PUT langsung ke signed upload URL Supabase (tidak lewat API/Vercel). Sengaja memakai XHR, bukan
 * instance `api`: tidak boleh membawa token sesi, dan XHR memberi progress upload.
 */
function putFile(url: string, file: File, headers: Record<string, string>, onProgress?: (pct: number) => void) {
  return new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url);
    for (const [k, v] of Object.entries(headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) onProgress?.(Math.round((e.loaded / e.total) * 100));
    };
    xhr.onload = () =>
      xhr.status >= 200 && xhr.status < 300
        ? resolve()
        : reject(new ApiError('STORAGE_PROVIDER_ERROR', `Upload ke penyimpanan gagal (HTTP ${xhr.status}).`, xhr.status));
    xhr.onerror = () => reject(new ApiError('NETWORK_ERROR', 'Upload ke penyimpanan gagal. Periksa koneksi.', 0));
    xhr.send(file);
  });
}

/** Minta signed upload URL → PUT file ke Supabase → kembalikan fileId untuk endpoint attach. */
export async function uploadDirect(file: File, purpose: FilePurpose, onProgress?: (pct: number) => void): Promise<string> {
  const target = await post<UploadUrlResponse>('/files/upload-url', {
    purpose,
    fileName: file.name,
    contentType: contentTypeOf(file),
    size: file.size,
  });
  await putFile(target.uploadUrl, file, target.headers, onProgress);
  return target.fileId;
}

/**
 * Lampirkan file ke endpoint attach: mode supabase → upload langsung lalu kirim { fileId, ...fields };
 * mode db → multipart seperti sebelumnya (field file = `fileField`).
 */
export async function attachFile<T>(opts: {
  url: string;
  file: File;
  purpose: FilePurpose;
  fileField: string;
  fields?: Record<string, string | number>;
  config: FilesConfig;
  onProgress?: (pct: number) => void;
}): Promise<T> {
  assertFileSize(opts.file, opts.config);
  if (opts.config.directUpload) {
    const fileId = await uploadDirect(opts.file, opts.purpose, opts.onProgress);
    return post<T>(opts.url, { ...opts.fields, fileId });
  }
  const fd = new FormData();
  for (const [k, v] of Object.entries(opts.fields ?? {})) fd.append(k, String(v));
  fd.append(opts.fileField, opts.file);
  return api.post(opts.url, fd, {
    onUploadProgress: (e) => {
      if (e.total) opts.onProgress?.(Math.round((e.loaded / e.total) * 100));
    },
  }) as unknown as Promise<T>;
}
