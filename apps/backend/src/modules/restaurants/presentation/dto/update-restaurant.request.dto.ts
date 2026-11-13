import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';

/**
 * ADR-052: at least one of `name`, `nameAr`, `nameEn` is required (checked
 * in the use case). Full-replace semantics, matching `UpdateUserProfileRequestDto`'s
 * established convention - every field required except the ones already
 * nullable in the domain. `slug` and `averageRating` are deliberately absent
 * - see `Restaurant.updateProfile()`'s own doc comment for why (slug is
 * URL-stable once created; averageRating is computed, never client-settable).
 */
export class UpdateRestaurantRequestDto {
  @ApiPropertyOptional({
    example: 'The Old Mill',
    description:
      'Legacy single name. Used only when neither nameAr nor nameEn is sent (ADR-052); then filed under the language of its script.',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional({ example: 'المطحنة القديمة', nullable: true, description: 'ADR-052' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameAr?: string | null;

  @ApiPropertyOptional({ example: 'The Old Mill', nullable: true, description: 'ADR-052' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  nameEn?: string | null;

  @ApiPropertyOptional({ example: 'A cozy neighborhood restaurant.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ADR-052: Arabic description.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionAr?: string | null;

  @ApiPropertyOptional({ nullable: true, description: 'ADR-052: English description.' })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  descriptionEn?: string | null;

  @ApiPropertyOptional({ example: 'Italian', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisineType?: string | null;

  @ApiPropertyOptional({
    example: 2,
    nullable: true,
    minimum: 1,
    maximum: 4,
    deprecated: true,
    description:
      'Ignored: the price level is computed from the menu (ADR-046). Still accepted so older clients keep working.',
  })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 4])
  priceLevel?: number | null;

  @ApiProperty({ enum: RestaurantStatus, example: RestaurantStatus.Active })
  @IsEnum(RestaurantStatus)
  status!: RestaurantStatus;
}
