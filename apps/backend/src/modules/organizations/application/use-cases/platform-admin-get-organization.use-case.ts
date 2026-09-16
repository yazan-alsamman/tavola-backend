import { Injectable, Inject } from '@nestjs/common';
import {
  OrganizationDetailRow,
  PlatformAdminOrganizationStatsReaderPort,
  PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
} from '../ports/platform-admin-organization-stats-reader.port';
import { OrganizationNotFoundException } from '../../domain/exceptions/organization-not-found.exception';

/**
 * Backs `GET /platform-admin/organizations/:id`. ADR-035 Pattern 2 — a pure
 * cross-tenant read with no mutation, so unlike the lifecycle use cases in
 * this module it performs no Explicit-Tenant-Rebind.
 *
 * Soft-deleted Organizations are returned rather than 404'd, with
 * `deletedAt` populated: the console must be able to inspect one before
 * deciding whether to Restore it, matching how `search` already treats them.
 */
@Injectable()
export class PlatformAdminGetOrganizationUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_ORGANIZATION_STATS_READER)
    private readonly reader: PlatformAdminOrganizationStatsReaderPort,
  ) {}

  async execute(query: { organizationId: string }): Promise<OrganizationDetailRow> {
    const row = await this.reader.findDetailById(query.organizationId);
    if (row === null) {
      throw new OrganizationNotFoundException();
    }
    return row;
  }
}
