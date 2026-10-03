import { Injectable } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { AppError } from '../../common/app-error';
import { env } from '../../common/env';
import { PrismaService } from '../../common/prisma.service';

export type FileKind = 'pdf' | 'png' | 'jpg';

const SIGNATURES: Record<FileKind, { magic: number[]; ext: string[]; mime: string[] }> = {
  pdf: { magic: [0x25, 0x50, 0x44, 0x46, 0x2d], ext: ['.pdf'], mime: ['application/pdf'] },
  png: { magic: [0x89, 0x50, 0x4e, 0x47], ext: ['.png'], mime: ['image/png'] },
  jpg: { magic: [0xff, 0xd8, 0xff], ext: ['.jpg', '.jpeg'], mime: ['image/jpeg'] },
};

export interface StoredFile {
  key: string;
  originalName: string;
  fileType: string;
  size: number;
}

/**
 * Penyimpanan file dengan dua driver (env STORAGE_DRIVER):
 *  - database : tabel stored_files di Postgres — default (dev & production berbagi DB)
 *  - local    : disk (apps/api/uploads) — hanya bila DB tidak dipakai bersama
 * File selalu disimpan dengan nama acak; tipe divalidasi lewat magic bytes.
 */
@Injectable()
export class StorageService {
  constructor(private readonly prisma: PrismaService) {}

  async save(file: Express.Multer.File | undefined, folder: string, allowed: FileKind[]): Promise<StoredFile> {
    if (!file) throw new AppError('VALIDATION_ERROR', 'File wajib diunggah.');
    if (file.size > LIMITS.FILE_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', 'Ukuran file maksimal 4MB.');

    const ext = path.extname(file.originalname).toLowerCase();
    const kind = allowed.find((k) => {
      const sig = SIGNATURES[k];
      return (
        sig.ext.includes(ext) &&
        sig.mime.includes(file.mimetype) &&
        sig.magic.every((byte, i) => file.buffer[i] === byte)
      );
    });
    if (!kind) {
      const names = allowed.map((k) => k.toUpperCase()).join('/');
      throw new AppError('INVALID_FILE_TYPE', `File harus berformat ${names} yang valid.`);
    }

    const key = `${folder}/${randomUUID()}${SIGNATURES[kind].ext[0]}`;
    const fileType = SIGNATURES[kind].mime[0];
    if (env().storageDriver === 'database') {
      await this.prisma.storedFile.create({ data: { key, data: new Uint8Array(file.buffer), contentType: fileType, size: file.size } });
    } else {
      const target = this.resolve(key);
      await fs.promises.mkdir(path.dirname(target), { recursive: true });
      await fs.promises.writeFile(target, file.buffer, { flag: 'wx' });
    }

    return { key, originalName: path.basename(file.originalname).slice(0, 200), fileType, size: file.size };
  }

  /**
   * Baca dari database dulu, lalu disk sebagai cadangan (file lama dari mode local) —
   * apa pun driver-nya, karena dev lokal & production bisa berbagi database.
   */
  async open(key: string): Promise<Readable> {
    const row = await this.prisma.storedFile.findUnique({ where: { key } });
    if (row) return Readable.from(Buffer.from(row.data));
    const target = this.resolve(key);
    if (fs.existsSync(target)) return fs.createReadStream(target);
    throw new AppError(
      'NOT_FOUND',
      'File tidak tersedia di server (kemungkinan diunggah dari lingkungan lokal lain). Minta pembuat campaign mengunggah ulang.',
    );
  }

  private resolve(key: string): string {
    const root = env().uploadDir;
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new AppError('NOT_FOUND', 'File tidak ditemukan.');
    return target;
  }
}
