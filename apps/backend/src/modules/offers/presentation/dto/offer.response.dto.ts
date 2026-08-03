import { ApiProperty } from '@nestjs/swagger';
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
      'Draft is editable/publishable/soft-deletable. Published is immutable, automatically expires at endsAt, and remains soft-deletable. Expired is terminal and soft-deletable.',
  })
  status!: OfferStatus;

  @ApiProperty({ format: 'date-time' })
  createdAt!: string;

  @ApiProperty({ format: 'date-time' })
  updatedAt!: string;
}
