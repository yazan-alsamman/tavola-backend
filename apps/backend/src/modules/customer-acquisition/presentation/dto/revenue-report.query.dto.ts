import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsIn, IsOptional, IsUUID } from 'class-validator';
import { RevenueReportGroupBy } from '../../application/dto/get-revenue-report.command';

const GROUP_BY_VALUES: RevenueReportGroupBy[] = [
  'day',
  'week',
  'month',
  'quarter',
  'year',
  'restaurant',
  'organization',
  'source',
];

export class RevenueReportQueryDto {
  @ApiProperty()
  @IsDateString()
  from!: string;

  @ApiProperty()
  @IsDateString()
  to!: string;

  @ApiProperty({ enum: GROUP_BY_VALUES })
  @IsIn(GROUP_BY_VALUES)
  groupBy!: RevenueReportGroupBy;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  restaurantId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

export class RevenueReportBucketResponseDto {
  @ApiProperty()
  key!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  recordedCount!: number;

  @ApiProperty()
  recordedTotal!: number;

  @ApiProperty()
  reversedCount!: number;

  @ApiProperty()
  reversedTotal!: number;
}

export class RevenueReportResponseDto {
  @ApiProperty({ enum: GROUP_BY_VALUES })
  groupBy!: RevenueReportGroupBy;

  @ApiProperty({ type: [RevenueReportBucketResponseDto] })
  buckets!: RevenueReportBucketResponseDto[];
}
