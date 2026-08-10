import { Injectable, Inject } from '@nestjs/common';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import { RestaurantId, BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import { PricingScopeType } from '../../domain/enums/customer-acquisition.enums';
import { AcquisitionPricingResolutionService } from '../../domain/services/acquisition-pricing-resolution.service';
import { NoMatchingPricingRuleException } from '../../domain/exceptions/no-matching-pricing-rule.exception';
import {
  CustomerAcquisitionRepository,
  CUSTOMER_ACQUISITION_REPOSITORY,
} from '../../domain/repositories/customer-acquisition.repository';
import {
  AcquisitionPricingRuleRepository,
  ACQUISITION_PRICING_RULE_REPOSITORY,
} from '../../domain/repositories/acquisition-pricing-rule.repository';
import {
  RecordAcquisitionOnApprovalCommand,
  RecordAcquisitionOnApprovalResult,
} from '../dto/record-acquisition-on-approval.command';

/**
 * ADR-033 §§1-4/§13 - the single write path shared by every place a
 * Reservation can first reach Approved: `ApproveReservationUseCase` (manual
 * staff approval), `CreateReservationUseCase`'s auto-approve branch, and
 * `WaitlistPromotionService`'s auto-approve branch. Must be called from
 * *inside* the same `UnitOfWorkPort` transaction as the Reservation's own
 * status write (§13's "same database transaction" requirement) - the DB
 * write happens here, synchronously, before that transaction commits; the
 * corresponding `CustomerAcquisitionRecordedEvent` is published by the
 * *caller* afterward, exactly like `ReservationApprovedEvent`/
 * `ReservationCreatedEvent` already are, only if `result.recorded` is true.
 *
 * Deliberately reuses `PlatformAdminRestaurantLookupReaderPort` (Phase 19.1)
 * rather than a new reader for the same `restaurantId -> organizationId`
 * data: a Customer's own booking request (`source = Online`) has no bound
 * `TenantContext.organizationId` (Customers are not OrganizationMembers), so
 * resolving organizationId here cannot go through the ordinary
 * tenant-scoped `RestaurantRepository` (which would throw
 * `TenantContextMissingException` for that actor). This is the same "no
 * single tenant bound yet" justification ADR-035 Pattern 2 already covers.
 */
@Injectable()
export class RecordCustomerAcquisitionOnApprovalService {
  constructor(
    @Inject(CUSTOMER_ACQUISITION_REPOSITORY)
    private readonly acquisitionRepository: CustomerAcquisitionRepository,
    @Inject(ACQUISITION_PRICING_RULE_REPOSITORY)
    private readonly pricingRuleRepository: AcquisitionPricingRuleRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantLookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
  ) {}

  async recordIfEligible(
    command: RecordAcquisitionOnApprovalCommand,
  ): Promise<RecordAcquisitionOnApprovalResult> {
    // ADR-033 §4: source = WalkIn never generates a fee.
    if (command.source === ReservationSource.WalkIn) {
      return { recorded: false };
    }

    // Product/architecture decision (2026-08-09, documented in DATABASE_SCHEMA.md's
    // Customer Acquisitions notes - not an ADR-033 amendment): Customer
    // Acquisition is a financial side-effect of a successful reservation
    // approval, never a prerequisite for it - mirrors ADR-027's own
    // "a restaurant must never become unable to accept reservations because
    // of its Organization's plan" principle (PRODUCT_REQUIREMENTS.md FR-12,
    // 2026-07-28 note), extended here to monetization configuration. A
    // Restaurant with NO configured operating currency at all (both
    // RestaurantSettings.defaultCurrency and Branch.currency null - the
    // out-of-the-box default for every restaurant) has not yet reached the
    // point ADR-033 §17 actually addresses ("if no rule exists in the
    // matching currency" presupposes a currency is already known) - this is
    // a silent, no-op skip, identical in shape to the WalkIn exclusion
    // above, never an exception. Once a currency IS configured, ADR-033
    // §17's fail-closed rule applies completely unchanged below.
    const currency = await this.resolveOperatingCurrency(command.restaurantId, command.branchId);
    if (currency === null) {
      return { recorded: false };
    }

    const lookup = await this.restaurantLookupReader.findOrganizationIdByRestaurantId(
      command.restaurantId,
    );
    const organizationId = lookup?.organizationId ?? null;

    const [restaurantCandidates, organizationCandidates, platformCandidates] = await Promise.all([
      this.pricingRuleRepository.findActiveCandidates(
        PricingScopeType.Restaurant,
        command.restaurantId,
      ),
      organizationId !== null
        ? this.pricingRuleRepository.findActiveCandidates(
            PricingScopeType.Organization,
            organizationId,
          )
        : Promise.resolve([]),
      this.pricingRuleRepository.findActiveCandidates(PricingScopeType.Platform, null),
    ]);

    const rule = AcquisitionPricingResolutionService.resolve({
      restaurantCandidates,
      organizationCandidates,
      platformCandidates,
      currency,
      now: command.now,
    });
    if (rule === null) {
      // ADR-033 §17 - fails closed. This aborts the caller's enclosing
      // UnitOfWorkPort transaction (the Reservation approval itself never
      // commits) - a disclosed, intentional consequence, not a bug: see
      // ADR-033's own Consequences/Negative section.
      throw new NoMatchingPricingRuleException(
        `No active AcquisitionPricingRule exists in currency "${currency}" for restaurant "${command.restaurantId}" (checked Restaurant, Organization, and Platform scope).`,
      );
    }

    const acquisition = CustomerAcquisition.recordAutomatic({
      id: this.idGenerator.generate(),
      restaurantId: command.restaurantId,
      userId: command.userId,
      reservationGuestId: command.reservationGuestId,
      sourceReservationId: command.sourceReservationId,
      reservationSource: command.source,
      feeAmount: rule.flatAmount!,
      feeCurrency: rule.flatCurrency!,
      pricingRuleId: rule.toProps().id,
      now: command.now,
    });

    // ADR-033 §9 - atomic insert-if-not-exists; the partial unique index is
    // the actual concurrency authority. A `false` here means an active
    // acquisition already exists for this (Restaurant, Customer-Identity)
    // pair (one-time-per-relationship, §5) - a safe, expected no-op, never
    // an error.
    const created = await this.acquisitionRepository.createIfNotExists(acquisition);
    if (!created) {
      return { recorded: false };
    }

    return {
      recorded: true,
      acquisitionId: acquisition.acquisitionId.value,
      feeAmount: acquisition.feeAmount,
      feeCurrency: acquisition.feeCurrency,
      pricingRuleId: acquisition.pricingRuleId.value,
      customerIdentityKey: acquisition.customerIdentityKey(),
    };
  }

  /**
   * ADR-033 §17: RestaurantSettings.defaultCurrency, falling back to
   * Branch.currency. Returns `null` (not a thrown exception) when neither
   * is configured - the caller treats that as a silent skip, not a fail-closed
   * error; see this method's caller for the full reasoning.
   */
  private async resolveOperatingCurrency(
    restaurantId: string,
    branchId: string,
  ): Promise<string | null> {
    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    if (settings?.defaultCurrency) {
      return settings.defaultCurrency;
    }
    const branch = await this.branchRepository.findById(BranchId.create(branchId));
    if (branch?.currency) {
      return branch.currency;
    }
    return null;
  }
}
