import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { RestaurantSuspendedEvent } from '../../domain/events/restaurant.events';
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
 * ADR-034 §3. Two-step: ADR-035 Pattern 2 resolves `restaurantId -> organizationId`
 * (no tenant identity is bound yet - `/platform-admin/restaurants/:id/suspend`
 * only supplies `restaurantId`), then ADR-035 Pattern 1 rebinds to that
 * resolved organization and mutates through the ordinary tenant-scoped
 * `RestaurantRepository` - the exact same `activate()`/`suspend()` entity
 * methods and `RestaurantSuspendedEvent`/`RestaurantActivatedEvent` the
 * existing Owner/Admin path (`UpdateRestaurantUseCase`) already uses, so
 * `RestaurantStatus` gains no new value and no dual-write path is
 * introduced. Idempotent - suspending an already-Suspended Restaurant is a
 * no-op (`Restaurant.suspend()`'s own existing invariant), matching
 * `UpdateRestaurantUseCase`'s behavior exactly. M1 remediation: `suspend()`
 * returns the same instance (reference-equal) when no transition occurred -
 * that case skips both the save and the event/audit write below, instead of
 * re-asserting a transition that didn't happen.
 */
@Injectable()
export class PlatformAdminSuspendRestaurantUseCase {
  constructor(
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly lookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
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
        const suspended = restaurant.suspend(now);
        const stateChanged = suspended !== restaurant;

        if (stateChanged) {
          await this.restaurantRepository.save(suspended);

          await this.eventPublisher.publish(
            new RestaurantSuspendedEvent(
              this.idGenerator.generate(),
              {
                restaurantId: suspended.restaurantId.value,
                organizationId: suspended.organizationId.value,
                actorId: command.actorId,
              },
              now,
              command.correlationId,
            ),
          );
        }

        return toPlatformAdminRestaurantResult(suspended);
      },
    );
  }
}
