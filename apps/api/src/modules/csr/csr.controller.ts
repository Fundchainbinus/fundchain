import { Body, Controller, Get, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUrl, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { ClientIp, CurrentUser, type CurrentUserPayload, Public, Roles } from '../../common/auth';
import { NotarizationWorker } from '../blockchain/notarization.worker';
import { CsrService } from './csr.service';

class CreateCompanyDto {
  @IsString() @MinLength(3, { message: 'Nama perusahaan minimal 3 karakter' }) @MaxLength(120)
  name!: string;

  @IsString() @MinLength(3, { message: 'Sektor minimal 3 karakter' }) @MaxLength(80)
  sector!: string;

  @IsOptional() @IsUrl({ require_protocol: true }, { message: 'Website harus URL lengkap (https://…)' }) @MaxLength(200)
  website?: string;

  @IsOptional() @IsString() @MaxLength(1000)
  description?: string;
}

class RecordContributionDto {
  @IsUUID('all', { message: 'companyId tidak valid' })
  companyId!: string;

  @IsUUID('all', { message: 'campaignId tidak valid' })
  campaignId!: string;

  @Type(() => Number)
  @IsInt({ message: 'Nominal harus bilangan bulat rupiah' })
  amount!: number;

  /** Nomor transfer bank / nomor MoU. Huruf, angka, titik, garis miring, strip. */
  @IsString()
  @Matches(/^[A-Za-z0-9./-]{4,60}$/, { message: 'Referensi 4-60 karakter: huruf, angka, titik, garis miring, atau strip' })
  reference!: string;
}

@Controller()
export class CsrController {
  constructor(
    private readonly csr: CsrService,
    private readonly worker: NotarizationWorker,
  ) {}

  @Public()
  @Get('csr/companies')
  companies() {
    return this.csr.listCompanies();
  }

  @Public()
  @Get('campaigns/:id/csr-sponsors')
  sponsors(@Param('id', ParseUUIDPipe) campaignId: string) {
    return this.csr.sponsorsOf(campaignId);
  }

  @Roles('ADMIN')
  @Post('admin/csr/companies')
  createCompany(@Body() dto: CreateCompanyDto, @CurrentUser() admin: CurrentUserPayload, @ClientIp() ip: string | null) {
    return this.csr.createCompany(dto, admin, ip);
  }

  @Roles('ADMIN')
  @Post('admin/csr/contributions')
  async record(@Body() dto: RecordContributionDto, @CurrentUser() admin: CurrentUserPayload, @ClientIp() ip: string | null) {
    const result = await this.csr.recordContribution(dto, admin, ip);
    this.worker.kick();
    return result;
  }
}
