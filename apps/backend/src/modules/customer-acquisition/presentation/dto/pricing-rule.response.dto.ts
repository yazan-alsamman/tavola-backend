import { ApiProperty } from '@nestjs/swagger';

export class PricingRuleResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ enum: ['Platform', 'Organization', 'Restaurant'] })
  scopeType!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  scopeId!: string | null;

  @ApiProperty({ enum: ['Flat', 'Percentage'] })
  feeType!: string;

  @ApiProperty({ nullable: true })
  flatAmount!: number | null;

  @ApiProperty({ nullable: true })
  flatCurrency!: string | null;

  @ApiProperty({ nullable: true })
  percentageValue!: number | null;

  @ApiProperty()
  effectiveFrom!: string;

  @ApiProperty({ nullable: true })
  effectiveTo!: string | null;

  @ApiProperty()
  label!: string;

  @ApiProperty({ format: 'uuid' })
  createdBy!: string;

  @ApiProperty({ nullable: true })
  archivedAt!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class PricingRuleListResponseDto {
  @ApiProperty({ type: [PricingRuleResponseDto] })
  items!: PricingRuleResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
