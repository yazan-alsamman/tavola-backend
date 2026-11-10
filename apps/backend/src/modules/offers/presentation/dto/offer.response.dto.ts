import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  OfferDiscountType,
  OfferStatus,
  OfferType,
} from '@modules/offers/domain/enums/offer.enums';

export class OfferResponseDto {
  @ApiProperty({ format: 'uuid' })
  offerId!: string;

  @ApiProperty({ format: 'uuid' })
  restaurantId!: string;

  @ApiProperty({ enum: OfferType })
  type!: OfferType;

  @ApiProperty({ example: '20% Off Weekday Lunch' })
  title!: string;

  @ApiProperty({ example: 'Enjoy 20% off any lunch entree, Monday through Friday.' })
  description!: string;

  @ApiProperty({ enum: OfferDiscountType })
  discountType!: OfferDiscountType;

  @ApiProperty({ example: 20 })
  discountValue!: number;

  @ApiProperty({ format: 'date-time' })
  startsAt!: string;

  @ApiProperty({ format: 'date-time' })
  endsAt!: string;

  @ApiProperty({
    enum: OfferStatus,
    description:
      'Draft is editable/publishable/soft-deletable. Published stays editable (ADR-047), automatically expires at endsAt, and remains soft-deletable. Expired is terminal and soft-deletable.',
  })
  status!: OfferStatus;

  @ApiProperty({
    type: [Number],
    example: [1, 2],
    description: '0 = Sunday ... 6 = Saturday, branch-local. Empty = every day (ADR-047).',
  })
  daysOfWeek!: number[];

  @ApiPropertyOptional({ example: '18:00', nullable: true, description: 'Branch-local "HH:mm".' })
  startTime!: string | null;

  @ApiPropertyOptional({
    example: '21:00',
    nullable: true,
    description: 'Branch-local "HH:mm" (exclusive).',
  })
  endTime!: string | null;

  @ApiPropertyOptional({ example: 4, nullable: true })
  minPartySize!: number | null;

  @ApiProperty({ type: [String], format: 'uuid', description: 'Empty = every branch.' })
  branchIds!: string[];

  @ApiProperty({ example: false })
  oncePerCustomer!: boolean;

  @ApiPropertyOptional({
    example: 50,
    nullable: true,
    description: 'Most bookings the offer may bring.',
  })
  bookingCap!: number | null;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
