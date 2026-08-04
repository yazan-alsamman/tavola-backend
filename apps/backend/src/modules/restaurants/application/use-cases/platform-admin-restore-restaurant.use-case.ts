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
import { RestaurantNotSoftDeletedException } from '../../domain/exceptions/restaurant-not-soft-deleted.exception';
import { RestaurantRestoredEvent } from '../../domain/events/restaurant.events';
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
 * ADR-034 §3 - closes a standing gap (no actor has ever had a restore
 * capability before this ADR). Uses `findByIdIncludingDeleted`, the one
 * legitimate exception to `RestaurantRepository.findById`'s "soft-deleted =
 * not found" convention - Restore needs to see the deleted row to undo it.
 * Rejects (409) a Restaurant that is not currently deleted, rather than a
 * silent no-op - Restore/Delete are meaningfully different operator
 * intentions, worth surfacing a conflict for.
 */
@Injectable()
export class PlatformAdminRestoreRestaurantUseCase {
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
        const restaurant = await this.restaurantRepository.findByIdIncludingDeleted(
          RestaurantId.create(command.restaurantId),
        );
        if (restaurant === null) {
          throw new RestaurantNotFoundException();
        }
        if (!restaurant.isSoftDeleted()) {
          throw new RestaurantNotSoftDeletedException();
        }

        const now = this.clock.now();
        const restored = restaurant.restore(now);
        await this.restaurantRepository.save(restored);

        await this.eventPublisher.publish(
          new RestaurantRestoredEvent(
            this.idGenerator.generate(),
            {
              restaurantId: restored.restaurantId.value,
              organizationId: restored.organizationId.value,
              actorId: command.actorId,
            },
            now,
            command.correlationId,
          ),
        );

        return toPlatformAdminRestaurantResult(restored);
      },
    );
  }
}
