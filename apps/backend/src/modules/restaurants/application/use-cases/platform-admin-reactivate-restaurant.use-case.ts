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
import { RestaurantActivatedEvent } from '../../domain/events/restaurant.events';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '../ports/platform-admin-restaurant-lookup-reader.port';
import { toPlatformAdminRestaurantResult } from '../mappers/platform-admin-restaurant-result.mapper';
import {
  PlatformAdminRestaurantLifecycleCommand,
  PlatformAdminRestaurantResult,
} from '../dto/platform-admin-restaurant-lifecycle.command';

/** ADR-034 §3 - see `PlatformAdminSuspendRestaurantUseCase`'s doc comment for the Pattern 2 -> Pattern 1 shape. */
@Injectable()
export class PlatformAdminReactivateRestaurantUseCase {
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
        const activated = restaurant.activate(now);
        await this.restaurantRepository.save(activated);

        await this.eventPublisher.publish(
          new RestaurantActivatedEvent(
            this.idGenerator.generate(),
            {
              restaurantId: activated.restaurantId.value,
              organizationId: activated.organizationId.value,
              actorId: command.actorId,
            },
            now,
            command.correlationId,
          ),
        );

        return toPlatformAdminRestaurantResult(activated);
      },
    );
  }
}
