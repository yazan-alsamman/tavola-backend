import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import {
  TenantContextPort,
  TENANT_CONTEXT_PORT,
} from '@shared/application/ports/tenant-context.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { CustomerAcquisitionId } from '@shared/domain/value-objects/identifiers.vo';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  CustomerAcquisitionRepository,
  CUSTOMER_ACQUISITION_REPOSITORY,
} from '../../domain/repositories/customer-acquisition.repository';
import { CustomerAcquisitionNotFoundException } from '../../domain/exceptions/customer-acquisition-not-found.exception';
import { CustomerAcquisitionReversedEvent } from '../../domain/events/customer-acquisition.events';
import { ReverseCustomerAcquisitionCommand } from '../dto/reverse-customer-acquisition.command';
import { CustomerAcquisitionResult } from '../dto/customer-acquisition.result';
import { toCustomerAcquisitionResult } from '../mappers/customer-acquisition-result.mapper';

/**
 * ADR-033 §10 - PlatformAdmin-only correction for an over-count. Pattern 2
 * (resolve `restaurantId -> organizationId` via the reused Phase 19.1
 * reader) -> Pattern 1 (Explicit Tenant Rebind), identical two-step shape to
 * `PlatformAdminSuspendRestaurantUseCase` - needed purely for correct
 * `organizationId` attribution on the resulting audit row
 * (`AuditingEventPublisher` reads `TenantContextService.getOrganizationId()`
 * for every event), since `CustomerAcquisition` itself is not in
 * `DIRECT_TENANT_OWNED_MODELS` and needs no rebind to be queried safely.
 */
@Injectable()
export class ReverseCustomerAcquisitionUseCase {
  constructor(
    @Inject(CUSTOMER_ACQUISITION_REPOSITORY)
    private readonly acquisitionRepository: CustomerAcquisitionRepository,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantLookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: ReverseCustomerAcquisitionCommand): Promise<CustomerAcquisitionResult> {
    const existing = await this.acquisitionRepository.findById(
      CustomerAcquisitionId.create(command.acquisitionId),
    );
    if (existing === null) {
      throw new CustomerAcquisitionNotFoundException();
    }

    const lookup = await this.restaurantLookupReader.findOrganizationIdByRestaurantId(
      existing.restaurantId.value,
    );
    if (lookup === null) {
      throw new RestaurantNotFoundException();
    }

    return this.tenantContext.runAsync(
      {
        organizationId: lookup.organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.acquisitionId,
        actorType: 'PlatformAdmin',
      },
      async () => {
        const now = this.clock.now();
        const reversed = existing.reverse(command.actorId, command.reason, now);
        await this.acquisitionRepository.save(reversed);

        await this.eventPublisher.publish(
          new CustomerAcquisitionReversedEvent(
            this.idGenerator.generate(),
            {
              acquisitionId: reversed.acquisitionId.value,
              restaurantId: reversed.restaurantId.value,
              reversedBy: command.actorId,
              reversalReason: command.reason,
            },
            now,
            command.correlationId,
          ),
        );

        return toCustomerAcquisitionResult(reversed);
      },
    );
  }
}
