import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

class OfferImpactComparisonDto {
  @ApiPropertyOptional({
    format: 'date-time',
    nullable: true,
    description: 'Start of the period run so far; null before the offer starts.',
  })
  from!: string | null;

  @ApiPropertyOptional({ format: 'date-time', nullable: true })
  to!: string | null;

  @ApiProperty({
    example: 42,
    description: "All bookings in the offer's days, hours and branches during that period.",
  })
  bookingsInOfferSlots!: number;

  @ApiPropertyOptional({
    example: 30.5,
    nullable: true,
    description: 'The same slots over the 4 weeks before the offer, scaled to the period.',
  })
  usualBookings!: number | null;

  @ApiPropertyOptional({
    example: 38,
    nullable: true,
    description: 'Whole percent over the usual; null with no usual bookings.',
  })
  liftPercent!: number | null;

  @ApiProperty({ example: 4 })
  baselineWeeks!: number;
}

class OfferEstimatedCostDto {
  @ApiPropertyOptional({ example: 'SYP', nullable: true })
  currency!: string | null;

  @ApiProperty({ example: 1250000 })
  amount!: number;

  @ApiProperty({ description: 'True when some visits had no branch reference price yet.' })
  partial!: boolean;
}

export class OfferImpactResponseDto {
  @ApiProperty({ format: 'uuid' })
  offerId!: string;

  @ApiProperty({ example: 1200, description: 'Times the offer appeared in a public list.' })
  views!: number;

  @ApiProperty({ example: 35 })
  bookings!: number;

  @ApiProperty({ example: 96 })
  persons!: number;

  @ApiProperty({ example: 28, description: 'Completed visits.' })
  attended!: number;

  @ApiPropertyOptional({
    example: 40,
    nullable: true,
    description: 'Share of bookings from guests new to the restaurant.',
  })
  newCustomerPercent!: number | null;

  @ApiProperty({ type: OfferImpactComparisonDto })
  comparison!: OfferImpactComparisonDto;

  @ApiProperty({ type: [OfferEstimatedCostDto], description: 'One entry per currency.' })
  estimatedCost!: OfferEstimatedCostDto[];

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;
}
