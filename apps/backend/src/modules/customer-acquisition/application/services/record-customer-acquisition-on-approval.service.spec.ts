import { RecordCustomerAcquisitionOnApprovalService } from './record-customer-acquisition-on-approval.service';
import { CustomerAcquisition } from '../../domain/entities/customer-acquisition.entity';
import { AcquisitionPricingRule } from '../../domain/entities/acquisition-pricing-rule.entity';
import {
  AcquisitionStatus,
  PricingFeeType,
  PricingScopeType,
} from '../../domain/enums/customer-acquisition.enums';
import { NoMatchingPricingRuleException } from '../../domain/exceptions/no-matching-pricing-rule.exception';
import { CustomerAcquisitionRepository } from '../../domain/repositories/customer-acquisition.repository';
import { AcquisitionPricingRuleRepository } from '../../domain/repositories/acquisition-pricing-rule.repository';
import { ReservationSource } from '@modules/reservations/domain/enums/reservation.enums';
import { PlatformAdminRestaurantLookupReaderPort } from '@modules/restaurants/application/ports/platform-admin-restaurant-lookup-reader.port';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { SequentialIdGenerator } from '../../../../../test/authentication/support/in-memory-registration.dependencies';

const RESTAURANT_ID = '11111111-1111-4111-8111-111111111111';
const BRANCH_ID = '22222222-2222-4222-8222-222222222222';
const ORGANIZATION_ID = '33333333-3333-4333-8333-333333333333';
const USER_ID = '44444444-4444-4444-8444-444444444444';
const RESERVATION_ID = '55555555-5555-4555-8555-555555555555';
const now = new Date('2026-08-09T12:00:00.000Z');

class FakeCustomerAcquisitionRepository implements CustomerAcquisitionRepository {
  public readonly created: CustomerAcquisition[] = [];
  private readonly activeIdentityKeys = new Set<string>();

  async findById() {
    return null;
  }
  async findActiveByRestaurantAndIdentity() {
    return null;
  }
  async findManyByRestaurantId() {
    return { items: [], total: 0 };
  }
  async countRecordedInWindow() {
    return 0;
  }
  async createIfNotExists(acquisition: CustomerAcquisition): Promise<boolean> {
    const key = `${acquisition.restaurantId.value}:${acquisition.customerIdentityKey()}`;
    if (this.activeIdentityKeys.has(key)) {
      return false;
    }
    this.activeIdentityKeys.add(key);
    this.created.push(acquisition);
    return true;
  }
  async save() {}
}

class FakePricingRuleRepository implements AcquisitionPricingRuleRepository {
  constructor(private readonly platformRules: AcquisitionPricingRule[] = []) {}
  async findById() {
    return null;
  }
  async findActiveCandidates(scopeType: PricingScopeType) {
    return scopeType === PricingScopeType.Platform ? this.platformRules : [];
  }
  async findMany() {
    return { items: [], total: 0 };
  }
  async save() {}
}

class FakeRestaurantLookupReader implements PlatformAdminRestaurantLookupReaderPort {
  async findOrganizationIdByRestaurantId(restaurantId: string) {
    return { restaurantId, organizationId: ORGANIZATION_ID };
  }
  async countByStatus() {
    return { total: 0, active: 0, suspended: 0, deleted: 0 };
  }
  async search() {
    return { items: [], total: 0 };
  }
}

function platformRule(flatCurrency: string): AcquisitionPricingRule {
  return AcquisitionPricingRule.create({
    id: '66666666-6666-4666-8666-666666666666',
    scopeType: PricingScopeType.Platform,
    scopeId: null,
    feeType: PricingFeeType.Flat,
    flatAmount: 1000,
    flatCurrency,
    effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
    effectiveTo: null,
    label: 'Default',
    createdBy: 'system',
    now: new Date('2026-01-01T00:00:00.000Z'),
  });
}

function build(params: {
  defaultCurrency?: string | null;
  branchCurrency?: string | null;
  pricingRules?: AcquisitionPricingRule[];
}) {
  const acquisitionRepository = new FakeCustomerAcquisitionRepository();
  const pricingRuleRepository = new FakePricingRuleRepository(
    params.pricingRules ?? [platformRule('SYP')],
  );
  const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
  const branchRepository = new InMemoryBranchRepository();

  if (params.defaultCurrency !== undefined) {
    void restaurantSettingsRepository.save(
      RestaurantSettings.create({
        id: 'settings-1',
        restaurantId: RESTAURANT_ID,
        reservationIntervalMinutes: 30,
        maxGuestsPerReservation: 20,
        cancellationWindowMinutes: 60,
        pendingReservationTimeoutMinutes: 15,
        defaultReservationDurationMinutes: 90,
        autoApproval: false,
        timezone: 'UTC',
        defaultCurrency: params.defaultCurrency,
        reservationReminderMinutesBefore: 60,
        lateArrivalGraceMinutes: 15,
        createdAt: now,
        updatedAt: now,
      }),
    );
  }

  if (params.branchCurrency !== undefined) {
    void branchRepository.save(
      Branch.create({
        id: BRANCH_ID,
        restaurantId: RESTAURANT_ID,
        city: 'Damascus',
        district: null,
        address: '123 Main St',
        latitude: null,
        longitude: null,
        countryCode: 'SY',
        currency: params.branchCurrency,
        timezone: 'UTC',
        phone: null,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
  }

  const service = new RecordCustomerAcquisitionOnApprovalService(
    acquisitionRepository,
    pricingRuleRepository,
    restaurantSettingsRepository,
    branchRepository,
    new FakeRestaurantLookupReader(),
    new SequentialIdGenerator([
      'aaaaaaaa-0000-4000-8000-000000000001',
      'aaaaaaaa-0000-4000-8000-000000000002',
    ]),
  );

  return { service, acquisitionRepository };
}

describe('RecordCustomerAcquisitionOnApprovalService', () => {
  it('records an acquisition and snapshots the resolved fee (ADR-033 §1-4/§18)', async () => {
    const { service, acquisitionRepository } = build({ defaultCurrency: 'SYP' });

    const result = await service.recordIfEligible({
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      reservationGuestId: null,
      source: ReservationSource.Online,
      sourceReservationId: RESERVATION_ID,
      now,
    });

    expect(result.recorded).toBe(true);
    expect(result.feeAmount).toBe(1000);
    expect(result.feeCurrency).toBe('SYP');
    expect(acquisitionRepository.created).toHaveLength(1);
    expect(acquisitionRepository.created[0].status).toBe(AcquisitionStatus.Recorded);
  });

  it('never generates a fee for source = WalkIn (ADR-033 §4)', async () => {
    const { service, acquisitionRepository } = build({ defaultCurrency: 'SYP' });

    const result = await service.recordIfEligible({
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      reservationGuestId: null,
      source: ReservationSource.WalkIn,
      sourceReservationId: RESERVATION_ID,
      now,
    });

    expect(result.recorded).toBe(false);
    expect(acquisitionRepository.created).toHaveLength(0);
  });

  it('is a no-op the second time for the same (Restaurant, Customer-Identity) pair (ADR-033 §5/§9)', async () => {
    const { service, acquisitionRepository } = build({ defaultCurrency: 'SYP' });
    const command = {
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      reservationGuestId: null,
      source: ReservationSource.Online,
      sourceReservationId: RESERVATION_ID,
      now,
    };

    const first = await service.recordIfEligible(command);
    const second = await service.recordIfEligible({
      ...command,
      sourceReservationId: 'another-reservation',
    });

    expect(first.recorded).toBe(true);
    expect(second.recorded).toBe(false);
    expect(acquisitionRepository.created).toHaveLength(1);
  });

  it('falls back to Branch.currency when RestaurantSettings.defaultCurrency is unset (ADR-033 §17)', async () => {
    const { service, acquisitionRepository } = build({
      defaultCurrency: null,
      branchCurrency: 'SYP',
    });

    const result = await service.recordIfEligible({
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      reservationGuestId: null,
      source: ReservationSource.Online,
      sourceReservationId: RESERVATION_ID,
      now,
    });

    expect(result.recorded).toBe(true);
    expect(acquisitionRepository.created).toHaveLength(1);
  });

  it('fails closed when no pricing rule matches the operating currency at any scope (ADR-033 §17)', async () => {
    const { service } = build({ defaultCurrency: 'USD', pricingRules: [platformRule('SYP')] });

    await expect(
      service.recordIfEligible({
        restaurantId: RESTAURANT_ID,
        branchId: BRANCH_ID,
        userId: USER_ID,
        reservationGuestId: null,
        source: ReservationSource.Online,
        sourceReservationId: RESERVATION_ID,
        now,
      }),
    ).rejects.toThrow(NoMatchingPricingRuleException);
  });

  it(
    'skips acquisition silently (never throws) when the restaurant has no configured operating ' +
      'currency at all - a financial side-effect must never block the underlying reservation ' +
      "approval it is attached to (product decision 2026-08-09, see this service's own doc comment)",
    async () => {
      const { service, acquisitionRepository } = build({
        defaultCurrency: null,
        branchCurrency: null,
      });

      const result = await service.recordIfEligible({
        restaurantId: RESTAURANT_ID,
        branchId: BRANCH_ID,
        userId: USER_ID,
        reservationGuestId: null,
        source: ReservationSource.Online,
        sourceReservationId: RESERVATION_ID,
        now,
      });

      expect(result).toEqual({ recorded: false });
      expect(acquisitionRepository.created).toHaveLength(0);
    },
  );

  it('also skips silently when RestaurantSettings exists but defaultCurrency is explicitly null and no Branch currency is set', async () => {
    const { service, acquisitionRepository } = build({
      defaultCurrency: null,
      branchCurrency: undefined,
    });

    const result = await service.recordIfEligible({
      restaurantId: RESTAURANT_ID,
      branchId: BRANCH_ID,
      userId: USER_ID,
      reservationGuestId: null,
      source: ReservationSource.Online,
      sourceReservationId: RESERVATION_ID,
      now,
    });

    expect(result.recorded).toBe(false);
    expect(acquisitionRepository.created).toHaveLength(0);
  });
});
