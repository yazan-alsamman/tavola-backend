import { ApiProperty } from '@nestjs/swagger';
import { IsDateString, IsEnum, IsNumber, IsString, MaxLength, MinLength } from 'class-validator';
import { OfferDiscountType, OfferType } from '@modules/offers/domain/enums/offer.enums';

export class CreateOfferRequestDto {
  @ApiProperty({ enum: OfferType, example: OfferType.Promotion })
  @IsEnum(OfferType)
  type!: OfferType;

  @ApiProperty({ example: '20% Off Weekday Lunch' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'Enjoy 20% off any lunch entree, Monday through Friday.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ enum: OfferDiscountType, example: OfferDiscountType.Percentage })
  @IsEnum(OfferDiscountType)
  discountType!: OfferDiscountType;

  @ApiProperty({
    example: 20,
    description: 'Percentage: > 0 and <= 100. FixedAmount: > 0.',
  })
  @IsNumber()
  discountValue!: number;

  @ApiProperty({ format: 'date-time', example: '2026-09-01T00:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-09-30T23:59:59.000Z' })
  @IsDateString()
  endsAt!: string;
}
