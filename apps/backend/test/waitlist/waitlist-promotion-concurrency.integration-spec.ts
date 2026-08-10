import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { WaitlistPromotionService } from '@modules/waitlist/application/services/waitlist-promotion.service';
import { PrismaReservationWaitlistEntryRepository } from '@modules/waitlist/infrastructure/persistence/prisma-reservation-waitlist-entry.repository';
import { ReservationWaitlistEntry } from '@modules/waitlist/domain/entities/reservation-waitlist-entry.entity';
import { WaitlistStatus } from '@modules/waitlist/domain/enums/waitlist.enums';
import { WaitlistExpirationSchedulerPort } from '@modules/waitlist/application/ports/waitlist-expiration-scheduler.port';
import { PrismaReservationRepository } from '@modules/reservations/infrastructure/persistence/prisma-reservation.repository';
import { ScheduleApprovedReservationSignalsService } from '@modules/reservations/application/services/schedule-approved-reservation-signals.service';
import { ApprovedReservationOperationalSchedulerPort } from '@modules/reservations/application/ports/approved-reservation-operational-scheduler.port';
import { PrismaRestaurantSettingsRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant-settings.repository';
import { PrismaTableRepository } from '@modules/tables/infrastructure/persistence/prisma-table.repository';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { DomainEvent } from '@shared/domain/base/domain-event.base';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { RecordCustomerAcquisitionOnApprovalService } from '@modules/customer-acquisition/application/services/record-customer-acquisition-on-approval.service';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';
import { InMemoryAcquisitionRecordingService } from '../reservations/support/in-memory-acquisition-recording.service';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'waitlist-promo-concurrency-';

class UuidGenerator implements IdGeneratorPort {
  generate(): string {
    return randomUUID();
  }
}

class CollectingEventPublisher implements EventPublisherPort {
  readonly events: DomainEvent[] = [];
  async publish(event: DomainEvent): Promise<void> {
    this.events.push(event);
  }
  async publishAll(events: DomainEvent[]): Promise<void> {
    this.events.push(...events);
  }
}

class NoopWaitlistExpirationScheduler implements WaitlistExpirationSchedulerPort {
  async scheduleExpiration(): Promise<void> {}
  async cancelExpiration(): Promise<void> {}
}

class NoopApprovedReservationOperationalScheduler implements ApprovedReservationOperationalSchedulerPort {
  async scheduleForApproved(): Promise<void> {}
  async replaceForApproved(): Promise<void> {}
  async cancelForReservation(): Promise<void> {}
}

describe('WaitlistPromotionService concurrency (real Postgres, real advisory locks)', () => {
  let dbAvailable = false;
  let service: WaitlistPromotionService;
  let waitlistRepository: PrismaReservationWaitlistEntryRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaReservationWaitlistEntryRepository,
      PrismaReservationRepository,
      PrismaTableRepository,
      PrismaUnitOfWork,
      PrismaRestaurantSettingsRepository,
    ]);
    waitlistRepository = moduleRef.get(PrismaReservationWaitlistEntryRepository);
    const reservationRepository = moduleRef.get(PrismaReservationRepository);
    const tableRepository = moduleRef.get(PrismaTableRepository);
    const unitOfWork = moduleRef.get(PrismaUnitOfWork);
    const restaurantSettingsRepository = moduleRef.get(PrismaRestaurantSettingsRepository);

    const scheduleApprovedReservationSignals = new ScheduleApprovedReservationSignalsService(
      new NoopApprovedReservationOperationalScheduler(),
      restaurantSettingsRepository,
    );
    service = new WaitlistPromotionService(
      waitlistRepository,
      reservationRepository,
      tableRepository,
      new UuidGenerator(),
      new CollectingEventPublisher(),
      unitOfWork,
      new NoopWaitlistExpirationScheduler(),
      scheduleApprovedReservationSignals,
      new InMemoryAcquisitionRecordingService() as unknown as RecordCustomerAcquisitionOnApprovalService,
    );

    org = await rawPrisma.organization.create({
      data: {
        name: 'Waitlist Promo Concurrency Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.reservationWaitlistEntry.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.reservation.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.table.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.floorPlan.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedScenario(tableCapacity: number): Promise<{
    restaurantId: string;
    branchId: string;
    tableId: string;
    userId: string;
  }> {
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    const branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'UTC',
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main Floor', isActive: true },
    });
    const table = await rawPrisma.table.create({
      data: {
        branchId: branch.id,
        floorPlanId: floorPlan.id,
        tableNumber: 'T1',
        capacity: tableCapacity,
      },
    });
    const user = await rawPrisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Customer',
        email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
    return { restaurantId: restaurant.id, branchId: branch.id, tableId: table.id, userId: user.id };
  }

  function buildAndSeedEntry(
    restaurantId: string,
    branchId: string,
    userId: string,
    position: number,
    preferredDate: Date,
    partySize = 2,
  ) {
    const now = new Date();
    const entry = ReservationWaitlistEntry.create({
      id: randomUUID(),
      restaurantId,
      branchId,
      userId,
      reservationGuestId: null,
      partySize,
      preferredDate,
      preferredTimeFrom: new Date(Date.UTC(1970, 0, 1, 19, 0, 0)),
      preferredTimeTo: null,
      position,
      expiresAt: new Date(preferredDate.getTime() + 86_399_999),
      notes: null,
      createdBy: userId,
      now,
    });
    return waitlistRepository.createInTransaction(entry).then(() => entry);
  }

  function promotionParams(entry: ReservationWaitlistEntry, promotedBy: string | null) {
    return {
      entry,
      branchTimezone: 'UTC',
      reservationIntervalMinutes: 30,
      defaultReservationDurationMinutes: 90,
      autoApproval: true,
      promotedBy,
      now: new Date(),
    };
  }

  it('a successful promotion atomically creates the Reservation and converts the entry together', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, userId } = await seedScenario(4);
    const preferredDate = new Date('2026-09-10T00:00:00.000Z');
    const entry = await buildAndSeedEntry(restaurantId, branchId, userId, 1, preferredDate);

    const outcome = await service.attemptPromotion(promotionParams(entry, null));

    expect(outcome.promoted).toBe(true);
    if (!outcome.promoted) throw new Error('expected promotion');

    const reservation = await rawPrisma.reservation.findUnique({
      where: { id: outcome.reservationId },
    });
    expect(reservation).not.toBeNull();
    expect(reservation?.source).toBe('WaitlistConversion');

    const converted = await waitlistRepository.findById(entry.entryId);
    expect(converted?.status).toBe(WaitlistStatus.Converted);
    expect(converted?.convertedReservationId).toBe(outcome.reservationId);
  });

  it('concurrent promotion attempts on the SAME entry never create two Reservations (only one wins the claim)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, userId } = await seedScenario(4);
    const preferredDate = new Date('2026-09-11T00:00:00.000Z');
    const entry = await buildAndSeedEntry(restaurantId, branchId, userId, 1, preferredDate);

    const attempts = 5;
    const outcomes = await Promise.all(
      Array.from({ length: attempts }, () =>
        service.attemptPromotion(promotionParams(entry, null)),
      ),
    );

    const successes = outcomes.filter((o) => o.promoted);
    expect(successes).toHaveLength(1);

    const finalEntry = await waitlistRepository.findById(entry.entryId);
    expect(finalEntry?.status).toBe(WaitlistStatus.Converted);

    const reservationCount = await rawPrisma.reservation.count({
      where: { branchId, source: 'WaitlistConversion' },
    });
    expect(reservationCount).toBe(1);
  });

  it('manual and automatic promotion racing for the same entry cannot create two Reservations', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, userId } = await seedScenario(4);
    const preferredDate = new Date('2026-09-12T00:00:00.000Z');
    const entry = await buildAndSeedEntry(restaurantId, branchId, userId, 1, preferredDate);

    const [manual, automatic] = await Promise.all([
      service.attemptPromotion(promotionParams(entry, 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee')),
      service.attemptPromotion(promotionParams(entry, null)),
    ]);

    const successes = [manual, automatic].filter((o) => o.promoted);
    expect(successes).toHaveLength(1);

    const reservationCount = await rawPrisma.reservation.count({
      where: { branchId, source: 'WaitlistConversion' },
    });
    expect(reservationCount).toBe(1);
  });

  it('two racing entries for the last available table: only one is promoted, ADR-013 still protects the Reservation (the other reports lost-claim-race or not-serviceable, never a duplicate confirmed booking)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, userId } = await seedScenario(4);
    const preferredDate = new Date('2026-09-13T00:00:00.000Z');
    const entryA = await buildAndSeedEntry(restaurantId, branchId, userId, 1, preferredDate, 2);
    const entryB = await buildAndSeedEntry(restaurantId, branchId, userId, 2, preferredDate, 2);

    const [outcomeA, outcomeB] = await Promise.all([
      service.attemptPromotion(promotionParams(entryA, null)),
      service.attemptPromotion(promotionParams(entryB, null)),
    ]);

    const successes = [outcomeA, outcomeB].filter((o) => o.promoted);
    // Only one table exists at this branch - only one entry can win it.
    expect(successes).toHaveLength(1);

    const reservationCount = await rawPrisma.reservation.count({
      where: { branchId, source: 'WaitlistConversion' },
    });
    expect(reservationCount).toBe(1);

    // The loser's entry must have rolled back to its pre-attempt state, not
    // be left half-Converted.
    const loserEntry = successes[0] === outcomeA ? entryB : entryA;
    const loserAfter = await waitlistRepository.findById(loserEntry.entryId);
    expect(loserAfter?.status).toBe(WaitlistStatus.Waiting);
    expect(loserAfter?.convertedReservationId).toBeNull();
  });

  it('a failed promotion attempt (no table available) leaves the entry Waiting, not Converted', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, userId } = await seedScenario(2);
    const preferredDate = new Date('2026-09-14T00:00:00.000Z');
    const entry = await buildAndSeedEntry(restaurantId, branchId, userId, 1, preferredDate, 8);

    const outcome = await service.attemptPromotion(promotionParams(entry, null));

    expect(outcome).toEqual({ promoted: false, reason: 'not-serviceable' });
    const unchanged = await waitlistRepository.findById(entry.entryId);
    expect(unchanged?.status).toBe(WaitlistStatus.Waiting);
    expect(unchanged?.convertedReservationId).toBeNull();
  });

  it('two "re-check worker" simulations for the same queue cannot double-convert the same entry (idempotent claim under replay)', async () => {
    if (!dbAvailable) return;

    const { restaurantId, branchId, userId } = await seedScenario(4);
    const preferredDate = new Date('2026-09-15T00:00:00.000Z');
    const entry = await buildAndSeedEntry(restaurantId, branchId, userId, 1, preferredDate);
    const branchIdVo = BranchId.create(branchId);

    async function simulateRecheckWorker(): Promise<void> {
      const active = await waitlistRepository.findActiveByBranchAndDateOrderedByPosition(
        branchIdVo,
        preferredDate,
      );
      for (const candidate of active) {
        const outcome = await service.attemptPromotion(promotionParams(candidate, null));
        if (outcome.promoted) return;
      }
    }

    // Simulate the BullMQ deterministic-jobId dedup being bypassed (e.g. a
    // duplicate/replayed job) - two workers scan the same queue concurrently.
    await Promise.all([simulateRecheckWorker(), simulateRecheckWorker()]);

    const reservationCount = await rawPrisma.reservation.count({
      where: { branchId, source: 'WaitlistConversion' },
    });
    expect(reservationCount).toBe(1);
    const finalEntry = await waitlistRepository.findById(entry.entryId);
    expect(finalEntry?.status).toBe(WaitlistStatus.Converted);
  });
});
