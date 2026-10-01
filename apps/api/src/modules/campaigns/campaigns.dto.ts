import { LIMITS, SDG_CODES } from '@fundchain/shared';
import { Transform, Type } from 'class-transformer';
import {
  IsBooleanString,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export class CreateCampaignDto {
  @IsString()
  @MinLength(LIMITS.TITLE_MIN, { message: `Judul minimal ${LIMITS.TITLE_MIN} karakter` })
  @MaxLength(LIMITS.TITLE_MAX, { message: `Judul maksimal ${LIMITS.TITLE_MAX} karakter` })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  title!: string;

  @IsString()
  @MinLength(LIMITS.DESCRIPTION_MIN, { message: `Deskripsi minimal ${LIMITS.DESCRIPTION_MIN} karakter` })
  @MaxLength(10_000)
  description!: string;

  @IsIn(SDG_CODES, { message: 'Kategori SDG tidak valid' })
  sdgCategory!: string;

  @Type(() => Number)
  @IsInt({ message: 'Target harus bilangan bulat rupiah' })
  @Min(LIMITS.DONATION_MIN, { message: 'Target minimal Rp10.000' })
  @Max(LIMITS.TARGET_MAX, { message: 'Target maksimal Rp1.000.000.000' })
  targetAmount!: number;

  @IsDateString({}, { message: 'Deadline harus tanggal yang valid' })
  deadline!: string;
}

export class UpdateCampaignDto {
  @IsOptional() @IsString() @MinLength(LIMITS.TITLE_MIN) @MaxLength(LIMITS.TITLE_MAX)
  title?: string;

  @IsOptional() @IsString() @MinLength(LIMITS.DESCRIPTION_MIN) @MaxLength(10_000)
  description?: string;

  @IsOptional() @IsIn(SDG_CODES, { message: 'Kategori SDG tidak valid' })
  sdgCategory?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(LIMITS.DONATION_MIN) @Max(LIMITS.TARGET_MAX)
  targetAmount?: number;

  @IsOptional() @IsDateString()
  deadline?: string;
}

export class ListCampaignsQuery {
  @IsOptional() @IsString()
  status?: string;

  @IsOptional() @IsString()
  sdg?: string;

  @IsOptional() @IsString() @MaxLength(100)
  q?: string;

  @IsOptional() @IsBooleanString()
  mine?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  limit?: number;

  @IsOptional() @IsString()
  cursor?: string;
}

export class ReasonDto {
  @IsString()
  @MinLength(LIMITS.REASON_MIN, { message: `Alasan minimal ${LIMITS.REASON_MIN} karakter` })
  @MaxLength(2000)
  reason!: string;
}
