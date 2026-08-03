import { ApiProperty } from '@nestjs/swagger';
import { RestaurantResponseDto } from '@modules/restaurants/presentation/dto/restaurant.response.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D9): every
 * field `RestaurantResponseDto` already carries, plus `hasActiveOffer`.
 * Used by the search/nearby/comparison result families only - the plain
 * `GET /discovery/restaurants/:id` detail route keeps returning the
 * unmodified `RestaurantResponseDto` (task instructions: "preserve all
 * existing Discovery browsing/detail behavior except where D11 intentionally
 * narrows" - `hasActiveOffer` is new search-family scope, not a change to
 * the pre-existing detail response).
 */
export class DiscoverableRestaurantResponseDto extends RestaurantResponseDto {
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
