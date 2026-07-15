import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { RestaurantStatus } from '../../domain/enums/restaurant.enums';

/**
 * Full-replace semantics, matching `UpdateUserProfileRequestDto`'s
 * established convention - every field required except the ones already
 * nullable in the domain. `slug` and `averageRating` are deliberately absent
 * - see `Restaurant.updateProfile()`'s own doc comment for why (slug is
 * URL-stable once created; averageRating is computed, never client-settable).
 */
export class UpdateRestaurantRequestDto {
  @ApiProperty({ example: 'The Old Mill' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional({ example: 'A cozy neighborhood restaurant.', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @ApiPropertyOptional({ example: 'Italian', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  cuisineType?: string | null;

  @ApiPropertyOptional({ example: 2, nullable: true, minimum: 1, maximum: 4 })
  @IsOptional()
  @IsInt()
  @IsIn([1, 2, 3, 4])
  priceLevel?: number | null;

  @ApiProperty({ enum: RestaurantStatus, example: RestaurantStatus.Active })
  @IsEnum(RestaurantStatus)
  status!: RestaurantStatus;
}
