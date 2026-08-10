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
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import { PricingScopeType } from '../../domain/enums/customer-acquisition.enums';
import { AcquisitionPricingResolutionService } from '../../domain/services/acquisition-pricing-resolution.service';
import { NoMatchingPricingRuleException } from '../../domain/exceptions/no-matching-pricing-rule.exception';
import { InvalidCustomerAcquisitionException } from '../../domain/exceptions/invalid-customer-acquisition.exception';
import {
  CustomerAcquisitionRepository,
  CUSTOMER_ACQUISITION_REPOSITORY,
} from '../../domain/repositories/customer-acquisition.repository';
import {
  AcquisitionPricingRuleRepository,
  ACQUISITION_PRICING_RULE_REPOSITORY,
} from '../../domain/repositories/acquisition-pricing-rule.repository';
import { CustomerAcquisitionManuallyRecordedEvent } from '../../domain/events/customer-acquisition.events';
import { ManuallyRecordCustomerAcquisitionCommand } from '../dto/manually-record-customer-acquisition.command';
import { CustomerAcquisitionResult } from '../dto/customer-acquisition.result';
import { toCustomerAcquisitionResult } from '../mappers/customer-acquisition-result.mapper';

/**
 * ADR-033 §11 - symmetric to Reversal: a PlatformAdmin-only path for an
 * under-count correction (an acquisition that should have been recorded
 * automatically but wasn't). Same Pattern-2-resolve -> Pattern-1-rebind
 * shape as Reversal. Still governed by the same uniqueness constraint
 * (§9) - a duplicate attempt surfaces the same partial-unique-index
 * violation as the automatic path, via `createIfNotExists` returning false.
 */
@Injectable()
export class ManuallyRecordCustomerAcquisitionUseCase {
  constructor(
    @Inject(CUSTOMER_ACQUISITION_REPOSITORY)
    private readonly acquisitionRepository: CustomerAcquisitionRepository,
    @Inject(ACQUISITION_PRICING_RULE_REPOSITORY)
    private readonly pricingRuleRepository: AcquisitionPricingRuleRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantLookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(
    command: ManuallyRecordCustomerAcquisitionCommand,
  ): Promise<CustomerAcquisitionResult> {
    if (command.reason.trim().length === 0) {
      throw new InvalidCustomerAcquisitionException('reason must not be empty.');
    }

    const lookup = await this.restaurantLookupReader.findOrganizationIdByRestaurantId(
      command.restaurantId,
    );
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
        const now = this.clock.now();
        const settings = await this.restaurantSettingsRepository.findByRestaurantId(
          RestaurantId.create(command.restaurantId),
        );
        const currency = settings?.defaultCurrency;
        if (!currency) {
          throw new NoMatchingPricingRuleException(
            `Restaurant "${command.restaurantId}" has no configured RestaurantSettings.defaultCurrency - cannot resolve a pricing rule.`,
          );
        }

        const [restaurantCandidates, organizationCandidates, platformCandidates] =
          await Promise.all([
            this.pricingRuleRepository.findActiveCandidates(
              PricingScopeType.Restaurant,
              command.restaurantId,
            ),
            this.pricingRuleRepository.findActiveCandidates(
              PricingScopeType.Organization,
              lookup.organizationId,
            ),
            this.pricingRuleRepository.findActiveCandidates(PricingScopeType.Platform, null),
          ]);

        const rule = AcquisitionPricingResolutionService.resolve({
          restaurantCandidates,
          organizationCandidates,
          platformCandidates,
          currency,
          now,
        });
        if (rule === null) {
          throw new NoMatchingPricingRuleException(
            `No active AcquisitionPricingRule exists in currency "${currency}" for restaurant "${command.restaurantId}" (checked Restaurant, Organization, and Platform scope).`,
          );
        }

        const acquisition = CustomerAcquisition.recordManual({
          id: this.idGenerator.generate(),
          restaurantId: command.restaurantId,
          userId: command.userId,
          reservationGuestId: command.reservationGuestId,
          feeAmount: rule.flatAmount!,
          feeCurrency: rule.flatCurrency!,
          pricingRuleId: rule.toProps().id,
          now,
        });

        const created = await this.acquisitionRepository.createIfNotExists(acquisition);
        if (!created) {
          throw new InvalidCustomerAcquisitionException(
            'An active acquisition already exists for this Restaurant/Customer-Identity pair - reverse it first if this is a genuine correction.',
          );
        }

        await this.eventPublisher.publish(
          new CustomerAcquisitionManuallyRecordedEvent(
            this.idGenerator.generate(),
            {
              acquisitionId: acquisition.acquisitionId.value,
              restaurantId: acquisition.restaurantId.value,
              customerIdentityKey: acquisition.customerIdentityKey(),
              feeAmount: acquisition.feeAmount,
              feeCurrency: acquisition.feeCurrency,
              recordedBy: command.actorId,
              reason: command.reason,
            },
            now,
            command.correlationId,
          ),
        );

        return toCustomerAcquisitionResult(acquisition);
      },
    );
  }
}
