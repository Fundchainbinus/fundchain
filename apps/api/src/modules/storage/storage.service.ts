import { Injectable } from '@nestjs/common';
import { LIMITS } from '@fundchain/shared';
import { randomUUID } from 'node:crypto';
import * as path from 'node:path';
import { Readable } from 'node:stream';
import { AppError } from '../../common/app-error';
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
 * Penyimpanan file upload (proposal & bukti pencairan) di tabel stored_files (Postgres).
 * Satu tempat untuk semua lingkungan — laptop mana pun dan Vercel melihat file yang sama.
 * Tidak ada penyimpanan ke disk lokal. Nama file diacak; tipe divalidasi lewat magic bytes.
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
    await this.prisma.storedFile.create({
      data: { key, data: new Uint8Array(file.buffer), contentType: fileType, size: file.size },
    });
    return { key, originalName: path.basename(file.originalname).slice(0, 200), fileType, size: file.size };
  }

  async open(key: string): Promise<Readable> {
    const row = await this.prisma.storedFile.findUnique({ where: { key } });
    if (!row) {
      throw new AppError('NOT_FOUND', 'File tidak tersedia di server. Minta pembuat campaign mengunggah ulang.');
    }
    return Readable.from(Buffer.from(row.data));
  }
}
