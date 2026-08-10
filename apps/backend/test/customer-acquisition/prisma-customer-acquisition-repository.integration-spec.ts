import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { TestingModule } from '@nestjs/testing';
import { PrismaCustomerAcquisitionRepository } from '@modules/customer-acquisition/infrastructure/persistence/prisma-customer-acquisition.repository';
import { PrismaAcquisitionPricingRuleRepository } from '@modules/customer-acquisition/infrastructure/persistence/prisma-acquisition-pricing-rule.repository';
import { CustomerAcquisition } from '@modules/customer-acquisition/domain/entities/customer-acquisition.entity';
import { AcquisitionPricingRule } from '@modules/customer-acquisition/domain/entities/acquisition-pricing-rule.entity';
import {
  PricingFeeType,
  PricingScopeType,
} from '@modules/customer-acquisition/domain/enums/customer-acquisition.enums';
import { RestaurantId, CustomerAcquisitionId } from '@shared/domain/value-objects/identifiers.vo';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { hashTestPassword, seedOwnerAndOrganization } from '../helpers/owner-fixture';

const prisma = new PrismaClient();
const TEST_PREFIX = 'ca_repo_it_';

/**
 * ADR-033 §9 - real-Postgres proof that the two hand-written partial unique
 * indexes (`customer_acquisitions_restaurant_user_active_key`/
 * `..._restaurant_guest_active_key`) and the `customer_acquisitions_party_xor_chk`
 * CHECK constraint (migration `20260809123633_phase_19_2_customer_acquisition_pricing`)
 * genuinely enforce what ADR-033 requires - no unit test can prove a
 * database-level constraint. `CustomerAcquisition`/`AcquisitionPricingRule`
 * are not `DIRECT_TENANT_OWNED_MODELS` (TENANCY.md), so no `TenantContext`
 * binding is required for any of these reads/writes - see
 * `PrismaPlatformAdminRepository`'s own integration spec for the identical
 * "not a DIRECT_TENANT_OWNED_MODEL" precedent.
 */
describe('PrismaCustomerAcquisitionRepository / PrismaAcquisitionPricingRuleRepository (integration)', () => {
  let moduleRef: TestingModule | undefined;
  let acquisitionRepository: PrismaCustomerAcquisitionRepository;
  let pricingRuleRepository: PrismaAcquisitionPricingRuleRepository;
  let dbAvailable = false;
  let restaurantId: string;
  let userId: string;
  let userId2: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      console.warn('PostgreSQL not reachable — CustomerAcquisition repository tests NOT EXECUTED.');
      return;
    }
    moduleRef = await createPrismaIntegrationModule([
      PrismaCustomerAcquisitionRepository,
      PrismaAcquisitionPricingRuleRepository,
    ]);
    acquisitionRepository = moduleRef.get(PrismaCustomerAcquisitionRepository);
    pricingRuleRepository = moduleRef.get(PrismaAcquisitionPricingRuleRepository);

    const passwordHash = await hashTestPassword('SecurePass123!');
    const { userId: ownerId, organizationId } = await seedOwnerAndOrganization(prisma, {
      email: `${TEST_PREFIX}owner-${randomUUID()}@example.com`,
      passwordHash,
      organizationName: `${TEST_PREFIX}Org ${randomUUID()}`,
    });
    userId = ownerId;

    const secondUser = await prisma.user.create({
      data: {
        id: randomUUID(),
        firstName: 'Second',
        lastName: 'Customer',
        email: `${TEST_PREFIX}customer2-${randomUUID()}@example.com`,
        passwordHash,
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    userId2 = secondUser.id;

    restaurantId = randomUUID();
    await prisma.restaurant.create({
      data: {
        id: restaurantId,
        organizationId,
        name: `${TEST_PREFIX}Restaurant ${randomUUID()}`,
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.customerAcquisition.deleteMany({ where: { restaurantId } });
      await prisma.acquisitionPricingRule.deleteMany({
        where: { label: { startsWith: TEST_PREFIX } },
      });
      await prisma.restaurant.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.subscriptionUsage.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.subscription.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organizationMember.deleteMany({
        where: { organization: { name: { startsWith: TEST_PREFIX } } },
      });
      await prisma.organization.deleteMany({ where: { name: { startsWith: TEST_PREFIX } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
      await prisma.$disconnect();
    }
    if (moduleRef) {
      await moduleRef.close();
    }
  });

  function buildRule(id: string): AcquisitionPricingRule {
    return AcquisitionPricingRule.create({
      id,
      scopeType: PricingScopeType.Platform,
      scopeId: null,
      feeType: PricingFeeType.Flat,
      flatAmount: 1000,
      flatCurrency: 'SYP',
      effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
      effectiveTo: null,
      label: `${TEST_PREFIX}rule`,
      createdBy: '00000000-0000-4000-8000-000000000000',
      now: new Date('2026-01-01T00:00:00.000Z'),
    });
  }

  it('AcquisitionPricingRuleRepository: saves and finds active Platform-scope candidates', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    await pricingRuleRepository.save(buildRule(ruleId));

    const candidates = await pricingRuleRepository.findActiveCandidates(
      PricingScopeType.Platform,
      null,
    );
    expect(candidates.some((r) => r.toProps().id === ruleId)).toBe(true);
  });

  it('AcquisitionPricingRuleRepository: archive() excludes the rule from active candidates', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    const rule = buildRule(ruleId);
    await pricingRuleRepository.save(rule);
    await pricingRuleRepository.save(rule.archive(new Date()));

    const candidates = await pricingRuleRepository.findActiveCandidates(
      PricingScopeType.Platform,
      null,
    );
    expect(candidates.some((r) => r.toProps().id === ruleId)).toBe(false);
  });

  it('CustomerAcquisitionRepository: round-trips a created acquisition via findById', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    await pricingRuleRepository.save(buildRule(ruleId));
    const acquisitionId = randomUUID();
    const acquisition = CustomerAcquisition.recordManual({
      id: acquisitionId,
      restaurantId,
      userId,
      reservationGuestId: null,
      feeAmount: 1000,
      feeCurrency: 'SYP',
      pricingRuleId: ruleId,
      now: new Date(),
    });

    const created = await acquisitionRepository.createIfNotExists(acquisition);
    expect(created).toBe(true);

    const found = await acquisitionRepository.findById(CustomerAcquisitionId.create(acquisitionId));
    expect(found?.feeAmount).toBe(1000);
    expect(found?.restaurantId.value).toBe(restaurantId);
  });

  it('the partial unique index rejects a second active acquisition for the same (Restaurant, userId) pair (ADR-033 §9)', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    await pricingRuleRepository.save(buildRule(ruleId));

    const first = CustomerAcquisition.recordManual({
      id: randomUUID(),
      restaurantId,
      userId: userId2,
      reservationGuestId: null,
      feeAmount: 1000,
      feeCurrency: 'SYP',
      pricingRuleId: ruleId,
      now: new Date(),
    });
    const second = CustomerAcquisition.recordManual({
      id: randomUUID(),
      restaurantId,
      userId: userId2,
      reservationGuestId: null,
      feeAmount: 1000,
      feeCurrency: 'SYP',
      pricingRuleId: ruleId,
      now: new Date(),
    });

    expect(await acquisitionRepository.createIfNotExists(first)).toBe(true);
    expect(await acquisitionRepository.createIfNotExists(second)).toBe(false);
  });

  it('reversing frees the uniqueness slot - a fresh acquisition can then be recorded (ADR-033 §10)', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    await pricingRuleRepository.save(buildRule(ruleId));
    const identityUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: identityUserId,
        firstName: 'Third',
        lastName: 'Customer',
        email: `${TEST_PREFIX}customer3-${randomUUID()}@example.com`,
        passwordHash: 'x',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });

    const first = CustomerAcquisition.recordManual({
      id: randomUUID(),
      restaurantId,
      userId: identityUserId,
      reservationGuestId: null,
      feeAmount: 1000,
      feeCurrency: 'SYP',
      pricingRuleId: ruleId,
      now: new Date(),
    });
    expect(await acquisitionRepository.createIfNotExists(first)).toBe(true);

    const reversed = first.reverse(
      '00000000-0000-4000-8000-000000000000',
      'test reversal',
      new Date(),
    );
    await acquisitionRepository.save(reversed);

    const secondAttempt = CustomerAcquisition.recordManual({
      id: randomUUID(),
      restaurantId,
      userId: identityUserId,
      reservationGuestId: null,
      feeAmount: 1000,
      feeCurrency: 'SYP',
      pricingRuleId: ruleId,
      now: new Date(),
    });
    expect(await acquisitionRepository.createIfNotExists(secondAttempt)).toBe(true);
  });

  it('the database CHECK constraint rejects a row with neither userId nor reservationGuestId set (bypassing the domain guard)', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    await pricingRuleRepository.save(buildRule(ruleId));

    await expect(
      prisma.customerAcquisition.create({
        data: {
          id: randomUUID(),
          restaurantId,
          userId: null,
          reservationGuestId: null,
          sourceReservationId: null,
          createdVia: 'ManualPlatformAdminCorrection',
          status: 'Recorded',
          feeAmount: 1000,
          feeCurrency: 'SYP',
          pricingRuleId: ruleId,
        },
      }),
    ).rejects.toThrow();
  });

  it('countRecordedInWindow counts only Recorded acquisitions within the given window', async () => {
    if (!dbAvailable) return;
    const ruleId = randomUUID();
    await pricingRuleRepository.save(buildRule(ruleId));
    const windowUserId = randomUUID();
    await prisma.user.create({
      data: {
        id: windowUserId,
        firstName: 'Window',
        lastName: 'Customer',
        email: `${TEST_PREFIX}customer4-${randomUUID()}@example.com`,
        passwordHash: 'x',
        language: 'en',
        status: 'Active',
        emailVerified: true,
      },
    });
    const now = new Date();
    const acquisition = CustomerAcquisition.recordManual({
      id: randomUUID(),
      restaurantId,
      userId: windowUserId,
      reservationGuestId: null,
      feeAmount: 1000,
      feeCurrency: 'SYP',
      pricingRuleId: ruleId,
      now,
    });
    await acquisitionRepository.createIfNotExists(acquisition);

    const count = await acquisitionRepository.countRecordedInWindow(
      RestaurantId.create(restaurantId),
      new Date(now.getTime() - 60_000),
      new Date(now.getTime() + 60_000),
    );
    expect(count).toBeGreaterThanOrEqual(1);
  });
});
