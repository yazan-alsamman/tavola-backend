import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  SubscriptionUsageRepository,
  SUBSCRIPTION_USAGE_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-usage.repository';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantDeletedEvent } from '../../domain/events/restaurant.events';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '../ports/platform-admin-restaurant-lookup-reader.port';
import { toPlatformAdminRestaurantResult } from '../mappers/platform-admin-restaurant-result.mapper';
import {
  PlatformAdminRestaurantLifecycleCommand,
  PlatformAdminRestaurantResult,
} from '../dto/platform-admin-restaurant-lifecycle.command';

/**
 * ADR-034 §3. Mirrors `DeleteRestaurantUseCase` exactly (soft delete,
 * `SubscriptionUsage.restaurantCount` decremented in the same transaction,
 * ADR-027 §11) - the only difference is the actor and the Pattern 2 -> Pattern
 * 1 tenant resolution `PlatformAdminSuspendRestaurantUseCase` documents. Works
 * regardless of current Active/Suspended status, matching the existing
 * Owner/Admin-facing Delete's own precedent (no status precondition there
 * either).
 */
@Injectable()
export class PlatformAdminDeleteRestaurantUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly lookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(SUBSCRIPTION_USAGE_REPOSITORY)
    private readonly subscriptionUsageRepository: SubscriptionUsageRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(
    command: PlatformAdminRestaurantLifecycleCommand,
  ): Promise<PlatformAdminRestaurantResult> {
    const lookup = await this.lookupReader.findOrganizationIdByRestaurantId(command.restaurantId);
    if (lookup === null) {
      throw new RestaurantNotFoundException();
    }

    return this.tenantContext.runAsync(
      {
        organizationId: lookup.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.restaurantId,
        actorType: 'PlatformAdmin',
      },
      async () => {
        const restaurant = await this.restaurantRepository.findById(
          RestaurantId.create(command.restaurantId),
        );
        if (restaurant === null) {
          throw new RestaurantNotFoundException();
        }

        const now = this.clock.now();
        const deleted = restaurant.softDelete(now);
        await this.unitOfWork.execute(async () => {
          await this.restaurantRepository.save(deleted);
          await this.subscriptionUsageRepository.decrementRestaurantCount(lookup.organizationId);
        });

        await this.eventPublisher.publish(
          new RestaurantDeletedEvent(
            this.idGenerator.generate(),
            {
              restaurantId: deleted.restaurantId.value,
              organizationId: deleted.organizationId.value,
              actorId: command.actorId,
            },
            now,
            command.correlationId,
          ),
        );

        return toPlatformAdminRestaurantResult(deleted);
      },
    );
  }
}
