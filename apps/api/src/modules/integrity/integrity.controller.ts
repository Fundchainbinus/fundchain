import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AppError } from '../../common/app-error';
import { ClientIp, CurrentUser, type CurrentUserPayload, Public, Roles } from '../../common/auth';
import { PrismaService } from '../../common/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BlockchainService } from '../blockchain/blockchain.service';
import { IntegrityService } from './integrity.service';

const VERIFY_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@Controller()
export class IntegrityController {
  constructor(
    private readonly integrity: IntegrityService,
    private readonly blockchain: BlockchainService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  @Public()
  @Get('blockchain/info')
  info() {
    return this.blockchain.info();
  }

  @Roles('ADMIN')
  @Throttle(VERIFY_LIMIT)
  @Post('admin/donations/:id/verify')
  @HttpCode(200)
  verifyDonation(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: CurrentUserPayload, @ClientIp() ip: string | null) {
    return this.integrity.verifyDonation(id, admin.id, ip);
  }

  @Roles('ADMIN')
  @Throttle(VERIFY_LIMIT)
  @Post('admin/campaigns/:id/verify')
  @HttpCode(200)
  verifyCampaign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() admin: CurrentUserPayload, @ClientIp() ip: string | null) {
    return this.integrity.verifyMany(admin.id, id, ip);
  }

  @Roles('ADMIN')
  @Throttle(VERIFY_LIMIT)
  @Post('admin/integrity/verify-all')
  @HttpCode(200)
  verifyAll(@CurrentUser() admin: CurrentUserPayload, @ClientIp() ip: string | null) {
    return this.integrity.verifyMany(admin.id, undefined, ip);
  }

  /** Antrekan ulang notarisasi yang FAILED. Hash yang dikirim tetap hash saat settlement. */
  @Roles('ADMIN')
  @Post('admin/blockchain/:donationId/retry')
  @HttpCode(200)
  async retry(
    @Param('donationId', ParseUUIDPipe) donationId: string,
    @CurrentUser() admin: CurrentUserPayload,
    @ClientIp() ip: string | null,
  ) {
    const { count } = await this.prisma.blockchainTransaction.updateMany({
      where: { donationId, status: 'FAILED' },
      data: { status: 'QUEUED', retryCount: 0, lastError: null, nextAttemptAt: new Date() },
    });
    if (count === 0) throw new AppError('BLOCKCHAIN_INVALID_STATUS', 'Hanya notarisasi FAILED yang bisa diulang.');
    await this.audit.log({
      actorId: admin.id,
      action: 'BLOCKCHAIN_RETRY_REQUESTED',
      entityType: 'Donation',
      entityId: donationId,
      ipAddress: ip,
    });
    return { donationId, status: 'QUEUED' };
  }
}
