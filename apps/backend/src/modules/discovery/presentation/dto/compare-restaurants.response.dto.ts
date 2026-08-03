import { ApiProperty } from '@nestjs/swagger';
import { DiscoverableRestaurantResponseDto } from './discoverable-restaurant.response.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D18/D19):
 * preserves the caller-requested `restaurantIds` order; an id that did not
 * resolve to a publicly-visible restaurant is silently absent - `items` may
 * therefore contain fewer entries than were requested (see
 * `CompareRestaurantsUseCase`'s own doc comment for why this is never
 * surfaced as a distinct error).
 */
export class CompareRestaurantsResponseDto {
  @ApiProperty({ type: [DiscoverableRestaurantResponseDto] })
  items!: DiscoverableRestaurantResponseDto[];
}
