import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import type { StoredFile as StoredFileRow } from '@prisma/client';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { AppError } from '../../common/app-error';
import { PrismaService } from '../../common/prisma.service';
import {
  type FileKind,
  type FilePurpose,
  isPurpose,
  kindByName,
  kindLabel,
  MAGIC_HEAD_BYTES,
  magicMatches,
  PURPOSE_FOLDER,
  PURPOSE_KINDS,
  safeOriginalName,
  SIGNATURES,
} from './file-types';
import { maxBytesFor, resolveStorageConfig, type StorageConfig } from './storage.config';
import { SupabaseStorageClient } from './supabase-storage.client';

export type { FileKind } from './file-types';

export interface StoredFile {
  key: string;
  originalName: string;
  fileType: string;
  size: number;
}

export interface UploadUrlInput {
  purpose: string;
  fileName: string;
  contentType: string;
  size: number;
}

/** Umur signed download URL (detik). */
export const DOWNLOAD_URL_TTL_SECONDS = 5 * 60;
/** Umur signed upload URL Supabase (ditetapkan Supabase: 2 jam). */
const UPLOAD_URL_TTL_SECONDS = 2 * 60 * 60;

/**
 * Penyimpanan file upload (proposal & bukti pencairan).
 * - driver `db` (default): isi file di tabel stored_files (bytea), upload multipart ≤4MB lewat API.
 * - driver `supabase` (BFD-42/BFD-15): isi di Supabase Storage (bucket privat); browser upload langsung
 *   ≤10MB lewat signed upload URL, lalu server memverifikasi magic bytes saat file di-attach.
 * Baris lama tetap dibaca sesuai `storageDriver` barisnya, bukan driver aktif.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger('Storage');

  constructor(private readonly prisma: PrismaService) {}

  onModuleInit() {
    const cfg = this.config();
    if (cfg.error) this.logger.error(cfg.error);
    else this.logger.log(`Storage driver: ${cfg.driver}${cfg.supabase ? ` (bucket ${cfg.supabase.bucket})` : ''}`);
  }

  config(): StorageConfig {
    return resolveStorageConfig();
  }

  /** Untuk web: mode upload & batas ukuran yang berlaku (GET /files/config). */
  publicConfig() {
    const { driver } = this.config();
    return { driver, maxBytes: maxBytesFor(driver), directUpload: driver === 'supabase' };
  }

  /** Klien untuk driver aktif; error bila driver aktif bukan supabase. */
  private writeClient(): SupabaseStorageClient {
    const cfg = this.config();
    if (cfg.driver !== 'supabase' || !cfg.supabase) {
      throw new AppError('STORAGE_DIRECT_UPLOAD_DISABLED', 'Upload langsung tidak aktif; unggah file lewat form biasa (maks 4MB).');
    }
    return new SupabaseStorageClient(cfg.supabase);
  }

  /** Klien untuk membaca baris supabase — tetap jalan walau STORAGE_DRIVER sudah dikembalikan ke db. */
  private readClient(): SupabaseStorageClient {
    const cfg = resolveStorageConfig({ ...process.env, STORAGE_DRIVER: 'supabase' });
    if (!cfg.supabase) throw new AppError('STORAGE_PROVIDER_ERROR', 'Konfigurasi Supabase Storage tidak lengkap di server.');
    return new SupabaseStorageClient(cfg.supabase);
  }

  /** Jalur multipart lewat API (≤4MB, batas body Vercel). Driver supabase → server meneruskan ke Storage. */
  async save(file: Express.Multer.File | undefined, folder: string, allowed: FileKind[]): Promise<StoredFile> {
    if (!file) throw new AppError('VALIDATION_ERROR', 'File wajib diunggah.');
    if (file.size > LIMITS.FILE_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', 'Ukuran file maksimal 4MB.');

    const ext = path.extname(file.originalname).toLowerCase();
    const kind = allowed.find((k) => {
      const sig = SIGNATURES[k];
      return sig.ext.includes(ext) && sig.mime.includes(file.mimetype) && magicMatches(k, file.buffer);
    });
    if (!kind) throw new AppError('INVALID_FILE_TYPE', `File harus berformat ${kindLabel(allowed)} yang valid.`);

    const key = `${folder}/${randomUUID()}${SIGNATURES[kind].ext[0]}`;
    const fileType = SIGNATURES[kind].mime[0];
    const originalName = safeOriginalName(file.originalname);
    const cfg = this.config();
    if (cfg.driver === 'supabase' && cfg.supabase) {
      const client = new SupabaseStorageClient(cfg.supabase);
      await client.upload(key, file.buffer, fileType);
      try {
        await this.prisma.storedFile.create({
          data: { key, data: null, contentType: fileType, size: file.size, storageDriver: 'supabase', originalName },
        });
      } catch (e) {
        await client.remove([key]).catch(() => undefined);
        throw e;
      }
    } else {
      await this.prisma.storedFile.create({
        data: { key, data: new Uint8Array(file.buffer), contentType: fileType, size: file.size, originalName },
      });
    }
    return { key, originalName, fileType, size: file.size };
  }

  /**
   * POST /files/upload-url: validasi nama/mime/ukuran yang dideklarasikan, buat baris PENDING,
   * kembalikan signed upload URL Supabase. Isi file belum dipercaya sampai confirmDirect().
   */
  async createUploadUrl(ownerId: string, input: UploadUrlInput) {
    const client = this.writeClient();
    if (!isPurpose(input.purpose)) throw new AppError('VALIDATION_ERROR', 'purpose harus campaign-document atau disbursement-proof.');
    const size = Number(input.size);
    if (!Number.isInteger(size) || size <= 0) throw new AppError('VALIDATION_ERROR', 'Ukuran file tidak valid.');
    if (size > LIMITS.FILE_MAX_BYTES_DIRECT) throw new AppError('FILE_TOO_LARGE', 'Ukuran file maksimal 10MB.');
    const allowed = PURPOSE_KINDS[input.purpose];
    const kind = kindByName(allowed, String(input.fileName ?? ''), String(input.contentType ?? '').toLowerCase());
    if (!kind) throw new AppError('INVALID_FILE_TYPE', `File harus berformat ${kindLabel(allowed)} yang valid.`);

    const contentType = SIGNATURES[kind].mime[0];
    const key = `${PURPOSE_FOLDER[input.purpose]}/${randomUUID()}${SIGNATURES[kind].ext[0]}`;
    const signed = await client.createSignedUploadUrl(key);
    const row = await this.prisma.storedFile.create({
      data: {
        key,
        data: null,
        contentType,
        size,
        storageDriver: 'supabase',
        status: 'PENDING',
        purpose: input.purpose,
        ownerId,
        originalName: safeOriginalName(input.fileName),
      },
    });
    return {
      fileId: row.id,
      uploadUrl: signed.url,
      token: signed.token,
      method: 'PUT' as const,
      headers: { 'Content-Type': contentType, 'x-upsert': 'false' },
      maxBytes: LIMITS.FILE_MAX_BYTES_DIRECT,
      expiresIn: UPLOAD_URL_TTL_SECONDS,
    };
  }

  /**
   * Attach file upload langsung: pastikan milik user, purpose cocok & masih PENDING, lalu baca byte awal
   * dari Storage untuk cek magic bytes, ukuran asli, dan content-type tersimpan. Tidak cocok → objek
   * & baris dihapus, INVALID_FILE_TYPE / FILE_TOO_LARGE.
   */
  async confirmDirect(fileId: string, ownerId: string, purpose: FilePurpose): Promise<StoredFile> {
    const client = this.writeClient();
    const row = await this.prisma.storedFile.findUnique({ where: { id: fileId } });
    if (!row || row.ownerId !== ownerId || row.storageDriver !== 'supabase') {
      throw new AppError('NOT_FOUND', 'File upload tidak ditemukan. Unggah ulang file.');
    }
    if (row.status !== 'PENDING') throw new AppError('FILE_NOT_PENDING', 'File ini sudah dipakai. Unggah ulang file.');
    if (row.purpose !== purpose) throw new AppError('VALIDATION_ERROR', 'File diunggah untuk keperluan lain.');

    let head;
    try {
      head = await client.readHead(row.key, MAGIC_HEAD_BYTES);
    } catch (e) {
      if (e instanceof AppError && e.code === 'NOT_FOUND') {
        throw new AppError('VALIDATION_ERROR', 'File belum selesai diunggah ke penyimpanan. Coba unggah ulang.');
      }
      throw e;
    }

    const allowed = PURPOSE_KINDS[purpose];
    const kind = allowed.find((k) => SIGNATURES[k].mime[0] === row.contentType);
    const storedType = (head.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (!kind || !magicMatches(kind, head.head) || storedType !== row.contentType) {
      await this.discard(client, row);
      throw new AppError('INVALID_FILE_TYPE', `File harus berformat ${kindLabel(allowed)} yang valid.`);
    }
    if (head.totalSize === null || head.totalSize <= 0 || head.totalSize > LIMITS.FILE_MAX_BYTES_DIRECT) {
      await this.discard(client, row);
      throw new AppError('FILE_TOO_LARGE', 'Ukuran file maksimal 10MB.');
    }

    const { count } = await this.prisma.storedFile.updateMany({
      where: { id: fileId, status: 'PENDING' },
      data: { status: 'CONFIRMED', size: head.totalSize },
    });
    if (count === 0) throw new AppError('FILE_NOT_PENDING', 'File ini sudah dipakai. Unggah ulang file.');
    return { key: row.key, originalName: row.originalName ?? 'file', fileType: row.contentType, size: head.totalSize };
  }

  private async discard(client: SupabaseStorageClient, row: StoredFileRow) {
    await client.remove([row.key]).catch((e) => this.logger.warn(`Gagal hapus objek ${row.key}: ${String(e)}`));
    await this.prisma.storedFile.delete({ where: { key: row.key } }).catch(() => undefined);
  }

  findById(id: string) {
    return this.prisma.storedFile.findUnique({ where: { id } });
  }

  async findByKey(key: string) {
    const row = await this.prisma.storedFile.findUnique({ where: { key } });
    if (!row) {
      throw new AppError('NOT_FOUND', 'File tidak tersedia di server. Minta pembuat campaign mengunggah ulang.');
    }
    return row;
  }

  /** Signed download URL (5 menit) untuk baris supabase; null untuk baris db (di-stream lewat API). */
  async signedDownloadUrl(row: Pick<StoredFileRow, 'key' | 'storageDriver'>): Promise<string | null> {
    if (row.storageDriver !== 'supabase') return null;
    return this.readClient().createSignedDownloadUrl(row.key, DOWNLOAD_URL_TTL_SECONDS);
  }

  async open(key: string): Promise<Readable> {
    const row = await this.findByKey(key);
    if (row.storageDriver === 'supabase') return this.readClient().download(row.key);
    if (!row.data) throw new AppError('NOT_FOUND', 'File tidak tersedia di server.');
    return Readable.from(Buffer.from(row.data));
  }
}
