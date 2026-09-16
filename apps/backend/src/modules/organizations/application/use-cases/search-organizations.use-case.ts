import { Injectable, Inject } from '@nestjs/common';
import {
  OrganizationLookupRow,
  OrganizationLookupStatusFilter,
  PlatformAdminOrganizationStatsReaderPort,
  PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
} from '../ports/platform-admin-organization-stats-reader.port';

export interface SearchOrganizationsQuery {
  q: string;
  status?: OrganizationLookupStatusFilter;
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
 *
 * `q` and `status` are independent and optional. Supplying neither lists
 * every Organization, newest first; supplying both narrows on each. An empty
 * or whitespace-only `q` is explicitly "no text filter", never a match
 * against the empty string — see the reader for why that distinction is load
 * bearing.
 */
@Injectable()
export class SearchOrganizationsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_ORGANIZATION_STATS_READER)
    private readonly reader: PlatformAdminOrganizationStatsReaderPort,
  ) {}

  async execute(query: SearchOrganizationsQuery): Promise<SearchOrganizationsResult> {
    const { items, total } = await this.reader.search({
      q: query.q,
      status: query.status,
      page: query.page,
      limit: query.limit,
    });
    return { items, total, page: query.page, limit: query.limit };
  }
}
