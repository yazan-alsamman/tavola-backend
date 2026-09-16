import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';
import { CreateRestaurantRequestDto } from './create-restaurant.request.dto';

/**
 * Extends the tenant-facing create DTO rather than restating its fields, so
 * the two routes can never disagree about what a valid Restaurant looks like
 * (name bounds, slug pattern, priceLevel range). The only addition is the
 * target Organization, which on the tenant route comes from the caller's own
 * JWT and therefore has no place in its body.
 */
export class PlatformAdminCreateRestaurantRequestDto extends CreateRestaurantRequestDto {
  @ApiProperty({
    format: 'uuid',
    description:
      'The Organization that will own this Restaurant. Must exist and not be soft-deleted. Its subscription limits still apply - a Platform Owner does not bypass the plan maxRestaurants cap.',
    example: '7a1f3d92-4c8b-4e15-9f20-6d3b8c1a5e04',
  })
  @IsUUID()
  organizationId!: string;
}
