import { Injectable, Inject } from '@nestjs/common';
import {
  OrganizationLookupRow,
  PlatformAdminOrganizationStatsReaderPort,
  PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
} from '../ports/platform-admin-organization-stats-reader.port';

export interface SearchOrganizationsQuery {
  q: string;
  page: number;
  limit: number;
}

export interface SearchOrganizationsResult {
  items: OrganizationLookupRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * ADR-034 §13 — narrow, per-entity lookup, a support tool not a search
 * engine. Read-only, available to both Platform tiers (§11). Reuses the
 * existing Pattern-2 `PlatformAdminOrganizationStatsReaderPort` verbatim -
 * no new reader class.
 */
@Injectable()
export class SearchOrganizationsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_ORGANIZATION_STATS_READER)
    private readonly reader: PlatformAdminOrganizationStatsReaderPort,
  ) {}

  async execute(query: SearchOrganizationsQuery): Promise<SearchOrganizationsResult> {
    const { items, total } = await this.reader.search(query.q, query.page, query.limit);
    return { items, total, page: query.page, limit: query.limit };
  }
}
