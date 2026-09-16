import { Injectable, Inject } from '@nestjs/common';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import {
  PlatformAdminOrganizationStatsReaderPort,
  PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
} from '@modules/organizations/application/ports/platform-admin-organization-stats-reader.port';
import { OrganizationNotFoundException } from '@modules/organizations/domain/exceptions/organization-not-found.exception';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantResult } from '../dto/restaurant.result';

export interface PlatformAdminCreateRestaurantCommand {
  organizationId: string;
  name: string;
  slug?: string;
  description: string | null;
  cuisineType: string | null;
  priceLevel: number | null;
  actorId: string;
  correlationId?: string;
}

/**
 * ADR-035 Pattern 1 (Explicit Tenant Rebind). A Platform Owner creates a
 * Restaurant *inside a named Organization*, so unlike the tenant route there
 * is no tenant identity bound by `TenantContextInterceptor` — this use case
 * establishes it explicitly from the validated `organizationId` before
 * delegating.
 *
 * It deliberately delegates to `CreateRestaurantUseCase` rather than
 * reimplementing creation. That use case owns a non-trivial invariant set —
 * slug uniqueness, the subscription `maxRestaurants` limit enforced via an
 * atomic conditional increment, and the atomic Restaurant +
 * RestaurantSettings + RestaurantUsage insert. Duplicating any of that here
 * would produce a second creation path that could drift: the obvious failure
 * is a Platform-Owner-created Restaurant with no `RestaurantSettings` row, a
 * state every downstream consumer assumes cannot exist.
 *
 * Consequences of that reuse, both intentional:
 *
 *  - Subscription limits still apply. A Platform Owner does not get to
 *    silently exceed a plan's `maxRestaurants`; exceeding it is a decision
 *    that belongs to changing the plan, not to bypassing the check. The
 *    caller receives the same `ORGANIZATION_LIMIT_EXCEEDED` error an Owner
 *    would, which names the real problem instead of hiding it.
 *  - An Organization with no Subscription cannot receive a Restaurant. That
 *    is the existing `SubscriptionNotFoundException`, surfaced unchanged.
 *
 * The Organization is existence-checked first so a bad `organizationId`
 * yields a clear 404 rather than surfacing as a confusing "subscription not
 * found" from two layers down. Soft-deleted Organizations are rejected: a
 * Restaurant created inside one would be immediately unreachable.
 */
@Injectable()
export class PlatformAdminCreateRestaurantUseCase {
  constructor(
    private readonly createRestaurantUseCase: CreateRestaurantUseCase,
    @Inject(PLATFORM_ADMIN_ORGANIZATION_STATS_READER)
    private readonly organizationReader: PlatformAdminOrganizationStatsReaderPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(command: PlatformAdminCreateRestaurantCommand): Promise<RestaurantResult> {
    const organization = await this.organizationReader.findDetailById(command.organizationId);
    if (organization === null || organization.deletedAt !== null) {
      throw new OrganizationNotFoundException();
    }

    return this.tenantContext.runAsync(
      {
        organizationId: command.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.organizationId,
        actorType: 'PlatformAdmin',
      },
      async () =>
        this.createRestaurantUseCase.execute({
          organizationId: command.organizationId,
          actorId: command.actorId,
          name: command.name,
          slug: command.slug,
          description: command.description,
          cuisineType: command.cuisineType,
          priceLevel: command.priceLevel,
          correlationId: command.correlationId,
        }),
    );
  }
}
