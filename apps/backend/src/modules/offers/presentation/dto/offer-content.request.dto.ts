import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { OfferDiscountType, OfferType } from '@modules/offers/domain/enums/offer.enums';
import { OFFER_TIME_PATTERN } from '@modules/offers/domain/policies/offer-conditions.policy';

/**
 * The fields Create and Update share (full replace). ADR-047 conditions are
 * optional; an omitted condition means "no restriction".
 */
export class OfferContentRequestDto {
  @ApiProperty({
    enum: OfferType,
    example: OfferType.BillDiscount,
    description:
      'New offers use BillDiscount, FreeItem, GroupPrice or QuietDays (ADR-047). Promotion/Coupon/Event remain valid for older offers.',
  })
  @IsEnum(OfferType)
  type!: OfferType;

  @ApiProperty({ example: 'خصم 20% على الغداء' })
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title!: string;

  @ApiProperty({ example: 'خصم 20% على الفاتورة من الاثنين إلى الخميس بين 12 و4.' })
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  description!: string;

  @ApiProperty({ enum: OfferDiscountType, example: OfferDiscountType.Percentage })
  @IsEnum(OfferDiscountType)
  discountType!: OfferDiscountType;

  @ApiProperty({
    example: 20,
    description:
      'Percentage: > 0 and <= 100. FixedAmount: > 0, in the branch currency (for FreeItem: the item worth).',
  })
  @IsNumber()
  discountValue!: number;

  @ApiProperty({ format: 'date-time', example: '2026-12-01T00:00:00.000Z' })
  @IsDateString()
  startsAt!: string;

  @ApiProperty({ format: 'date-time', example: '2026-12-31T23:59:59.000Z' })
  @IsDateString()
  endsAt!: string;

  @ApiPropertyOptional({
    type: [Number],
    example: [1, 2, 3, 4],
    description: '0 = Sunday ... 6 = Saturday, branch-local. Omitted or empty = every day.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(7)
  @IsInt({ each: true })
  @Min(0, { each: true })
  @Max(6, { each: true })
  daysOfWeek?: number[];

  @ApiPropertyOptional({
    example: '12:00',
    nullable: true,
    description: 'Branch-local "HH:mm". Give both times or neither.',
  })
  @IsOptional()
  @Matches(OFFER_TIME_PATTERN, { message: 'startTime must match "HH:mm"' })
  startTime?: string | null;

  @ApiPropertyOptional({ example: '16:00', nullable: true, description: 'Exclusive.' })
  @IsOptional()
  @Matches(OFFER_TIME_PATTERN, { message: 'endTime must match "HH:mm"' })
  endTime?: string | null;

  @ApiPropertyOptional({ example: 4, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  minPartySize?: number | null;

  @ApiPropertyOptional({
    type: [String],
    format: 'uuid',
    description:
      'Branches of this restaurant the offer applies to. Omitted or empty = every branch.',
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('all', { each: true })
  branchIds?: string[];

  @ApiPropertyOptional({ example: false, description: 'A guest may book with this offer once.' })
  @IsOptional()
  @IsBoolean()
  oncePerCustomer?: boolean;

  @ApiPropertyOptional({
    example: 50,
    nullable: true,
    description: 'Most bookings the offer may bring.',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  bookingCap?: number | null;
}
