import { Injectable, Inject } from '@nestjs/common';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '../../domain/repositories/subscription.repository';
import { SubscriptionNotFoundException } from '../../domain/exceptions/subscription-not-found.exception';
import { toSubscriptionResult } from '../mappers/subscription-result.mapper';
import { SubscriptionResult } from '../dto/subscription.result';

/**
 * Read-only. Shared by both PlatformAdmin (`GET
 * /platform-admin/organizations/:id/subscription`, explicit target org) and
 * Organization Owner/Admin (`GET /organizations/subscription`, own org
 * implicit from JWT - see that controller route's own doc comment for why
 * it carries no `:id`, an implementation-time route-naming reconciliation).
 * Always (re)binds `TenantContext` to the given `organizationId` via
 * `TenantContextPort` - a harmless no-op rebind for the Owner/Admin case
 * (already bound to the same value by `TenantContextInterceptor`), and the
 * only way this resolves correctly for the PlatformAdmin case (whose guard
 * never binds `TenantContext` at all).
 */
@Injectable()
export class GetOrganizationSubscriptionUseCase {
  constructor(
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
  ) {}

  async execute(organizationId: string): Promise<SubscriptionResult> {
    return this.tenantContext.runAsync(
      { organizationId, userId: null, correlationId: organizationId },
      async () => {
        const subscription = await this.subscriptionRepository.findByOrganizationId();
        if (subscription === null) {
          throw new SubscriptionNotFoundException();
        }
        return toSubscriptionResult(subscription);
      },
    );
  }
}
