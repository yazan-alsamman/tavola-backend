import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsUUID } from 'class-validator';

export class ExportAcquisitionsQueryDto {
  @ApiProperty()
  @IsDateString()
  from!: string;

  @ApiProperty()
  @IsDateString()
  to!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class ExportAcquisitionRowResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid' })
  organizationId!: string;

  @ApiProperty()
  customerIdentityKey!: string;

  @ApiProperty()
  createdVia!: string;

  @ApiProperty()
  status!: string;

  @ApiProperty()
  feeAmount!: number;

  @ApiProperty()
  feeCurrency!: string;

  @ApiProperty()
  recordedAt!: string;

  @ApiProperty({ nullable: true })
  reversedAt!: string | null;
}

export class ExportAcquisitionsResponseDto {
  @ApiProperty({ type: [ExportAcquisitionRowResponseDto] })
  rows!: ExportAcquisitionRowResponseDto[];

  @ApiProperty()
  total!: number;
}
