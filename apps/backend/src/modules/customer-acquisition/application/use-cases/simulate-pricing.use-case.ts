import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  PlatformAdminRestaurantLookupReaderPort,
  PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER,
} from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  CustomerAcquisitionRepository,
  CUSTOMER_ACQUISITION_REPOSITORY,
} from '../../domain/repositories/customer-acquisition.repository';
import { InvalidCustomerAcquisitionException } from '../../domain/exceptions/invalid-customer-acquisition.exception';
import { SimulatePricingCommand, SimulatePricingResult } from '../dto/simulate-pricing.command';

const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 365;
const MILLISECONDS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * ADR-033 §19 - stateless, read-only preview: proposed rule x recent
 * acquisition volume -> a projected cost estimate. No persisted "draft rule"
 * state - the caller supplies the proposed flat amount/currency directly,
 * nothing is written. Illustrative only, never a commitment (enforced by
 * the `isEstimateOnly: true` literal on the result, never omitted).
 */
@Injectable()
export class SimulatePricingUseCase {
  constructor(
    @Inject(CUSTOMER_ACQUISITION_REPOSITORY)
    private readonly acquisitionRepository: CustomerAcquisitionRepository,
    @Inject(PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER)
    private readonly restaurantLookupReader: PlatformAdminRestaurantLookupReaderPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: SimulatePricingCommand): Promise<SimulatePricingResult> {
    if (!Number.isFinite(command.proposedFlatAmount) || command.proposedFlatAmount < 0) {
      throw new InvalidCustomerAcquisitionException(
        'proposedFlatAmount must be a non-negative finite number.',
      );
    }
    const lookbackDays = command.lookbackDays ?? DEFAULT_LOOKBACK_DAYS;
    if (!Number.isInteger(lookbackDays) || lookbackDays < 1 || lookbackDays > MAX_LOOKBACK_DAYS) {
      throw new InvalidCustomerAcquisitionException(
        `lookbackDays must be an integer between 1 and ${MAX_LOOKBACK_DAYS}.`,
      );
    }

    const lookup = await this.restaurantLookupReader.findOrganizationIdByRestaurantId(
      command.restaurantId,
    );
    if (lookup === null) {
      throw new RestaurantNotFoundException();
    }

    const now = this.clock.now();
    const from = new Date(now.getTime() - lookbackDays * MILLISECONDS_PER_DAY);
    const recentAcquisitionCount = await this.acquisitionRepository.countRecordedInWindow(
      RestaurantId.create(command.restaurantId),
      from,
      now,
    );

    return {
      restaurantId: command.restaurantId,
      lookbackDays,
      recentAcquisitionCount,
      proposedFlatAmount: command.proposedFlatAmount,
      proposedFlatCurrency: command.proposedFlatCurrency,
      projectedCost: command.proposedFlatAmount * recentAcquisitionCount,
      isEstimateOnly: true,
    };
  }
}
