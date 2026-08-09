import { ApiProperty } from '@nestjs/swagger';
import { RestaurantPublicResponseDto } from './restaurant-public.response.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D9): every
 * field `RestaurantPublicResponseDto` already carries (which itself already
 * includes `workingHours` - Public Working Hours, customer-facing
 * correction), plus `hasActiveOffer`. Used by the search/nearby/comparison
 * result families - the plain `GET /discovery/restaurants/:id` detail route
 * returns `RestaurantPublicResponseDto` directly (task instructions:
 * "preserve all existing Discovery browsing/detail behavior except where
 * D11 intentionally narrows" - `hasActiveOffer` is search-family-only scope,
 * not a change to the pre-existing detail response's own field set).
 */
export class DiscoverableRestaurantResponseDto extends RestaurantPublicResponseDto {
  @ApiProperty({
    example: false,
    description:
      'D9: true if this restaurant currently has at least one Published, active (startsAt <= now < endsAt), non-deleted Offer - the exact same public-active predicate GET /discovery/restaurants/:id/offers already owns, never a second definition.',
  })
  hasActiveOffer!: boolean;

  @ApiProperty({
    example: false,
    description:
      'ADR-031 decision #9 (Phase 18, implemented 2026-08-03): true iff this restaurant currently has an active, non-deleted, isDefault Menu. No search/indexing/recommendation surface - a derived existence flag only.',
  })
  hasMenu!: boolean;
}
