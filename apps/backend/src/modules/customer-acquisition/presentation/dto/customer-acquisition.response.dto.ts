import { ApiProperty } from '@nestjs/swagger';

export class CustomerAcquisitionResponseDto {
  @ApiProperty({ format: 'uuid' })
  id!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ format: 'uuid', nullable: true })
  userId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  reservationGuestId!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  sourceReservationId!: string | null;

  @ApiProperty({ nullable: true })
  reservationSource!: string | null;

  @ApiProperty({ enum: ['Automatic', 'ManualPlatformAdminCorrection'] })
  createdVia!: string;

  @ApiProperty({ enum: ['Recorded', 'Reversed'] })
  status!: string;

  @ApiProperty()
  feeAmount!: number;

  @ApiProperty()
  feeCurrency!: string;

  @ApiProperty({ format: 'uuid' })
  pricingRuleId!: string;

  @ApiProperty()
  recordedAt!: string;

  @ApiProperty({ nullable: true })
  reversedAt!: string | null;

  @ApiProperty({ format: 'uuid', nullable: true })
  reversedBy!: string | null;

  @ApiProperty({ nullable: true })
  reversalReason!: string | null;

  @ApiProperty()
  createdAt!: string;

  @ApiProperty()
  updatedAt!: string;
}

export class CustomerAcquisitionListResponseDto {
  @ApiProperty({ type: [CustomerAcquisitionResponseDto] })
  items!: CustomerAcquisitionResponseDto[];

  @ApiProperty()
  total!: number;

  @ApiProperty()
  page!: number;

  @ApiProperty()
  limit!: number;
}
