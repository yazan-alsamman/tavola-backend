import { Injectable, Inject } from '@nestjs/common';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
  RestaurantLookupRow,
} from '../ports/platform-admin-restaurant-lookup-reader.port';

export interface SearchRestaurantsQuery {
  q: string;
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
 */
@Injectable()
export class SearchRestaurantsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly reader: PlatformAdminRestaurantLookupReaderPort,
  ) {}

  async execute(query: SearchRestaurantsQuery): Promise<SearchRestaurantsResult> {
    const { items, total } = await this.reader.search(query.q, query.page, query.limit);
    return { items, total, page: query.page, limit: query.limit };
  }
}
