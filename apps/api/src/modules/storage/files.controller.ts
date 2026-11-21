import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Res, StreamableFile } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsString, MaxLength } from 'class-validator';
import type { Response } from 'express';
import { AppError } from '../../common/app-error';
import { CurrentUser, type CurrentUserPayload, Public } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { createSignedQuery, verifySignedQuery } from '../../common/signed-link';
import { CampaignsService } from '../campaigns/campaigns.service';
import { DOWNLOAD_URL_TTL_SECONDS, StorageService } from './storage.service';

/** Validasi isi (purpose, ekstensi/mime, ukuran) sengaja di StorageService supaya kode errornya spesifik. */
export class UploadUrlDto {
  @IsString()
  purpose!: string;

  @IsString()
  @MaxLength(255)
  fileName!: string;

  @IsString()
  @MaxLength(100)
  contentType!: string;

  @Type(() => Number)
  @IsInt({ message: 'Ukuran file harus bilangan bulat (byte)' })
  size!: number;
}

/**
 * BFD-42 / BFD-15: upload langsung ke Supabase Storage + akses file seragam lewat GET /files/:id.
 * Hak akses mengikuti pemilik file: dokumen campaign → aturan dokumen; bukti pencairan → admin atau
 * pengaju; file yang belum di-attach → hanya pengunggahnya.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly campaigns: CampaignsService,
  ) {}

  @Public()
  @Get('config')
  config() {
    return this.storage.publicConfig();
  }

  @Post('upload-url')
  uploadUrl(@Body() dto: UploadUrlDto, @CurrentUser() user: CurrentUserPayload) {
    return this.storage.createUploadUrl(user.id, dto);
  }

  /** Selalu JSON { url }: supabase → signed URL Storage (5 menit); db → URL API bertanda tangan. */
  @Public()
  @Get(':id/link')
  async link(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() user?: CurrentUserPayload) {
    const { row } = await this.authorize(id, user);
    const direct = await this.storage.signedDownloadUrl(row);
    return {
      url: direct ?? `/api/v1/files/${id}?${createSignedQuery(`file:${id}`)}`,
      expiresIn: DOWNLOAD_URL_TTL_SECONDS,
    };
  }

  /**
   * supabase → JSON { url } (signed download URL; tidak diproxy karena respons Vercel juga dibatasi 4,5MB).
   * db → stream isi file seperti sebelumnya. `e`/`t` = tanda tangan dari /files/:id/link (tab baru).
   */
  @Public()
  @Get(':id')
  async file(
    @Param('id', ParseUUIDPipe) id: string,
    @Res({ passthrough: true }) res: Response,
    @Query('e') e?: string,
    @Query('t') t?: string,
    @CurrentUser() user?: CurrentUserPayload,
  ) {
    const signedOk = verifySignedQuery(`file:${id}`, e, t);
    const { row, name } = signedOk ? await this.lookup(id) : await this.authorize(id, user);
    const direct = await this.storage.signedDownloadUrl(row);
    if (direct) return { url: direct, expiresIn: DOWNLOAD_URL_TTL_SECONDS };
    const stream = await this.storage.open(row.key);
    res.setHeader('Content-Type', row.contentType);
    res.setHeader('Content-Disposition', `inline; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream);
  }

  /** Cari baris file + entitas pemiliknya (dokumen campaign / pencairan). */
  private async lookup(id: string) {
    const row = await this.storage.findById(id);
    if (!row) throw new AppError('NOT_FOUND', 'File tidak ditemukan.');
    const doc = await this.prisma.campaignDocument.findFirst({ where: { storageKey: row.key } });
    const disbursement = doc ? null : await this.prisma.disbursement.findFirst({ where: { proofKey: row.key } });
    const name = doc?.originalName ?? disbursement?.proofName ?? row.originalName ?? 'file';
    return { row, doc, disbursement, name };
  }

  async authorize(id: string, user?: CurrentUserPayload) {
    const found = await this.lookup(id);
    const { row, doc, disbursement } = found;
    if (doc) {
      await this.campaigns.assertDocumentVisible(doc.id, user);
      return found;
    }
    if (disbursement) {
      if (!user) throw new AppError('AUTH_UNAUTHENTICATED', 'Masuk terlebih dahulu.');
      if (user.role !== 'ADMIN' && user.id !== disbursement.requesterId) {
        throw new AppError('AUTH_FORBIDDEN', 'Anda tidak memiliki akses ke bukti ini.');
      }
      return found;
    }
    // Belum di-attach (mis. PENDING): hanya pengunggahnya.
    if (!user || !row.ownerId || row.ownerId !== user.id) throw new AppError('NOT_FOUND', 'File tidak ditemukan.');
    return found;
  }
}
