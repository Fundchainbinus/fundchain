import { Injectable } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { AppError } from '../../common/app-error';
import { env } from '../../common/env';

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
 * Adapter penyimpanan lokal (disk). Interface sengaja kecil supaya bisa diganti Supabase Storage.
 * File disimpan dengan nama acak di luar folder yang bisa dieksekusi.
 */
@Injectable()
export class StorageService {
  async save(file: Express.Multer.File | undefined, folder: string, allowed: FileKind[]): Promise<StoredFile> {
    if (!file) throw new AppError('VALIDATION_ERROR', 'File wajib diunggah.');
    if (file.size > LIMITS.FILE_MAX_BYTES) throw new AppError('FILE_TOO_LARGE', 'Ukuran file maksimal 5MB.');

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
    const target = this.resolve(key);
    await fs.promises.mkdir(path.dirname(target), { recursive: true });
    await fs.promises.writeFile(target, file.buffer, { flag: 'wx' });

    return {
      key,
      originalName: path.basename(file.originalname).slice(0, 200),
      fileType: SIGNATURES[kind].mime[0],
      size: file.size,
    };
  }

  open(key: string): fs.ReadStream {
    const target = this.resolve(key);
    if (!fs.existsSync(target)) throw new AppError('NOT_FOUND', 'File tidak ditemukan.');
    return fs.createReadStream(target);
  }

  private resolve(key: string): string {
    const root = env().uploadDir;
    const target = path.resolve(root, key);
    if (!target.startsWith(root + path.sep)) throw new AppError('NOT_FOUND', 'File tidak ditemukan.');
    return target;
  }
}
