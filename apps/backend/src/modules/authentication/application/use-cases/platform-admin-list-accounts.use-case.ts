import { Inject, Injectable } from '@nestjs/common';
import {
  PlatformAdminAccountQuery,
  PlatformAdminAccountReaderPort,
  PlatformAdminAccountRow,
  PLATFORM_ADMIN_ACCOUNT_READER,
} from '../ports/platform-admin-account-reader.port';

export interface ListPlatformAdminAccountsResult {
  items: PlatformAdminAccountRow[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Backs `GET /platform-admin/accounts`. This endpoint is what makes the rest
 * of the `/platform-admin/accounts/:userId/*` family usable at all: those
 * four actions (force-logout, reset-credentials, disable-login,
 * enable-login) have existed since Phase 19.1, but nothing ever exposed a
 * way to *find* a `userId`. A console was left requiring an operator to
 * paste a UUID from somewhere else, which is a backend gap, not a frontend
 * one.
 *
 * ADR-035 Pattern 2 - read-only, no tenant rebind. Available to both
 * Platform tiers: it is a read, and ADR-034 §11 restricts `PlatformSupport`
 * from mutations only.
 */
@Injectable()
export class PlatformAdminListAccountsUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_ACCOUNT_READER)
    private readonly reader: PlatformAdminAccountReaderPort,
  ) {}

  async execute(query: PlatformAdminAccountQuery): Promise<ListPlatformAdminAccountsResult> {
    const { items, total } = await this.reader.search(query);
    return { items, total, page: query.page, limit: query.limit };
  }
}
