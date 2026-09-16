import { Injectable, Inject } from '@nestjs/common';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
  RestaurantDetailRow,
} from '../ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';

/**
 * Backs `GET /platform-admin/restaurants/:id`. ADR-035 Pattern 2 — a pure
 * cross-tenant read, so unlike the lifecycle use cases it needs no
 * Explicit-Tenant-Rebind step: there is no mutation to perform through the
 * tenant-scoped repository, and resolving the owning organization is part of
 * the read itself.
 *
 * Soft-deleted Restaurants are returned rather than 404'd — the console must
 * be able to inspect one before deciding whether to Restore it, and the
 * response carries `deletedAt` so the caller can render that state
 * explicitly instead of inferring it.
 */
@Injectable()
export class PlatformAdminGetRestaurantUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly reader: PlatformAdminRestaurantLookupReaderPort,
  ) {}

  async execute(query: { restaurantId: string }): Promise<RestaurantDetailRow> {
    const row = await this.reader.findDetailById(query.restaurantId);
    if (row === null) {
      throw new RestaurantNotFoundException();
    }
    return row;
  }
}
