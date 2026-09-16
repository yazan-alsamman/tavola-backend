import { Injectable, Inject } from '@nestjs/common';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
  RestaurantLookupRow,
  RestaurantLookupStatusFilter,
} from '../ports/platform-admin-restaurant-lookup-reader.port';

export interface SearchRestaurantsQuery {
  q: string;
  status?: RestaurantLookupStatusFilter;
  page: number;
  limit: number;
}

export interface SearchRestaurantsResult {
  items: RestaurantLookupRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * ADR-034 §13 — narrow, per-entity lookup, a support tool not a search
 * engine. Read-only, available to both Platform tiers (§11). Reuses the
 * existing Pattern-2 `PlatformAdminRestaurantLookupReaderPort` verbatim
 * (already the sole cross-tenant Restaurant reader) - no new reader class.
 *
 * `q` and `status` are independent and optional. Supplying neither lists
 * every Restaurant, newest first; supplying both narrows on each. An empty
 * or whitespace-only `q` is explicitly "no text filter", never a match
 * against the empty string — see the reader for why that distinction is load
 * bearing.
 */
@Injectable()
export class SearchRestaurantsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly reader: PlatformAdminRestaurantLookupReaderPort,
  ) {}

  async execute(query: SearchRestaurantsQuery): Promise<SearchRestaurantsResult> {
    const { items, total } = await this.reader.search({
      q: query.q,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return { items, total, page: query.page, limit: query.limit };
  }
}
