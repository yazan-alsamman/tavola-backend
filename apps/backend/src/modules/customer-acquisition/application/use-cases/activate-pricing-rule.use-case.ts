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
import {
  AcquisitionPricingRuleId,
  OrganizationId,
} from '@shared/domain/value-objects/identifiers.vo';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { OrganizationRepository } from '@modules/organizations/domain/repositories/organization.repository';
import { ORGANIZATION_REPOSITORY } from '@modules/organizations/application/tokens/organizations.tokens';
import { OrganizationNotFoundException } from '@modules/organizations/domain/exceptions/organization-not-found.exception';
import { AcquisitionPricingRule } from '../../domain/entities/acquisition-pricing-rule.entity';
import { PricingScopeType } from '../../domain/enums/customer-acquisition.enums';
import {
  AcquisitionPricingRuleRepository,
  ACQUISITION_PRICING_RULE_REPOSITORY,
} from '../../domain/repositories/acquisition-pricing-rule.repository';
import { AcquisitionPricingRuleActivatedEvent } from '../../domain/events/customer-acquisition.events';
import { ActivatePricingRuleCommand } from '../dto/activate-pricing-rule.command';
import { PricingRuleResult } from '../dto/pricing-rule.result';
import { toPricingRuleResult } from '../mappers/pricing-rule-result.mapper';

/**
 * ADR-033 §14/§15 - creates a new rule (rules are never edited in place) and
 * optionally archives the superseded rule in the same operation.
 * `scopeType = Platform` needs no tenant rebind at all (genuinely global
 * reference data, alongside `SubscriptionPlan`); `Organization`/`Restaurant`
 * scope validates the target exists, then rebinds Tenant Context purely for
 * correct audit-row `organizationId` attribution (the same reason
 * Reverse/ManuallyRecord do) - `AcquisitionPricingRule` itself is not in
 * `DIRECT_TENANT_OWNED_MODELS` and needs no rebind to be written safely.
 */
@Injectable()
export class ActivatePricingRuleUseCase {
  constructor(
    @Inject(ACQUISITION_PRICING_RULE_REPOSITORY)
    private readonly pricingRuleRepository: AcquisitionPricingRuleRepository,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantLookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(ORGANIZATION_REPOSITORY)
    private readonly organizationRepository: OrganizationRepository,
    @Inject(TENANT_CONTEXT_PORT) private readonly tenantContext: TenantContextPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: ActivatePricingRuleCommand): Promise<PricingRuleResult> {
    const organizationId = await this.resolveOrganizationId(command);

    const run = async (): Promise<PricingRuleResult> => {
      const now = this.clock.now();

      if (command.supersedesRuleId) {
        const superseded = await this.pricingRuleRepository.findById(
          AcquisitionPricingRuleId.create(command.supersedesRuleId),
        );
        if (superseded !== null) {
          await this.pricingRuleRepository.save(superseded.archive(now));
        }
      }

      const rule = AcquisitionPricingRule.create({
        id: this.idGenerator.generate(),
        scopeType: command.scopeType,
        scopeId: command.scopeId,
        feeType: command.feeType,
        flatAmount: command.flatAmount,
        flatCurrency: command.flatCurrency,
        effectiveFrom: command.effectiveFrom,
        effectiveTo: command.effectiveTo,
        label: command.label,
        createdBy: command.actorId,
        now,
      });
      await this.pricingRuleRepository.save(rule);

      await this.eventPublisher.publish(
        new AcquisitionPricingRuleActivatedEvent(
          this.idGenerator.generate(),
          {
            ruleId: rule.ruleId.value,
            scopeType: rule.scopeType,
            scopeId: rule.scopeId,
            feeType: rule.feeType,
            effectiveFrom: rule.effectiveFrom.toISOString(),
            createdBy: command.actorId,
          },
          now,
          command.correlationId,
        ),
      );

      return toPricingRuleResult(rule);
    };

    if (organizationId === null) {
      return run();
    }

    return this.tenantContext.runAsync(
      {
        organizationId,
        userId: null,
        correlationId: command.correlationId ?? command.label,
        actorType: 'PlatformAdmin',
      },
      run,
    );
  }

  private async resolveOrganizationId(command: ActivatePricingRuleCommand): Promise<string | null> {
    if (command.scopeType === PricingScopeType.Platform) {
      return null;
    }
    if (command.scopeType === PricingScopeType.Restaurant) {
      const lookup = await this.restaurantLookupReader.findOrganizationIdByRestaurantId(
        command.scopeId!,
      );
      if (lookup === null) {
        throw new RestaurantNotFoundException();
      }
      return lookup.organizationId;
    }
    const organization = await this.organizationRepository.findById(
      OrganizationId.create(command.scopeId!),
    );
    if (organization === null) {
      throw new OrganizationNotFoundException();
    }
    return command.scopeId!;
  }
}
