import { ApiProperty } from '@nestjs/swagger';
import { DiscoverableRestaurantResponseDto } from './discoverable-restaurant.response.dto';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D2): the
 * nearest qualifying Branch's id and the exact (Haversine-refined) distance
 * in kilometers - the deduplication rule (D2) guarantees exactly one row per
 * Restaurant, so there is no ambiguity about which Branch these fields refer
 * to.
 */
export class NearbyRestaurantResponseDto extends DiscoverableRestaurantResponseDto {
  @ApiProperty({ format: 'uuid' })
  nearestBranchId!: string;

  @ApiProperty({
    example: 2.35,
    description: 'Kilometers, Haversine-exact (not the bounding-box approximation).',
  })
  distanceKm!: number;
}
