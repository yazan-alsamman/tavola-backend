import { UpdateBranchWorkingHoursUseCase } from './update-branch-working-hours.use-case';
import { CreateBranchUseCase } from './create-branch.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { InvalidBranchWorkingHoursException } from '../../domain/exceptions/invalid-branch-working-hours.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryBranchWorkingHoursRepository } from '../../../../../test/branches/support/in-memory-branch-working-hours.repository';

describe('UpdateBranchWorkingHoursUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '55555555-5555-4555-8555-555555555555';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  function buildRestaurant(id: string): Restaurant {
    return Restaurant.create({
      id,
      organizationId,
      name: 'The Old Mill',
      slug: `the-old-mill-${id}`,
      logoId: null,
      coverImageId: null,
      description: null,
      cuisineType: null,
      averageRating: null,
      priceLevel: null,
      status: RestaurantStatus.Active,
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
  }

  async function seedBranch(
    branchRepository: InMemoryBranchRepository,
    restaurantRepository: InMemoryRestaurantRepository,
  ): Promise<string> {
    const createUseCase = new CreateBranchUseCase(
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
      restaurantId,
      city: 'Damascus',
      district: null,
      address: '123 Main St',
      latitude: null,
      longitude: null,
      countryCode: 'SY',
      currency: null,
      timezone: 'Asia/Damascus',
      phone: null,
    });
    return result.branchId;
  }

  function createUseCase(overrides?: { auditLogWriter?: CollectingAuditLogWriter }) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const branchRepository = new InMemoryBranchRepository();
    const branchWorkingHoursRepository = new InMemoryBranchWorkingHoursRepository();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new UpdateBranchWorkingHoursUseCase(
      restaurantRepository,
      branchRepository,
      branchWorkingHoursRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      auditLogWriter,
    );
    return {
      useCase,
      restaurantRepository,
      branchRepository,
      branchWorkingHoursRepository,
      auditLogWriter,
    };
  }

  const validEntries = [
    {
      dayOfWeek: 1,
      openingTime: '09:00',
      closingTime: '22:00',
      breakStartTime: null,
      breakEndTime: null,
    },
    {
      dayOfWeek: 2,
      openingTime: '09:00',
      closingTime: '22:00',
      breakStartTime: '15:00',
      breakEndTime: '16:00',
    },
  ];

  async function setupWithBranch() {
    const context = createUseCase();
    await context.restaurantRepository.save(buildRestaurant(restaurantId));
    await context.restaurantRepository.save(buildRestaurant(otherRestaurantId));
    const branchId = await seedBranch(context.branchRepository, context.restaurantRepository);
    return { ...context, branchId };
  }

  it('persists the submitted week and returns it sorted by dayOfWeek', async () => {
    const { useCase, branchId } = await setupWithBranch();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      entries: [...validEntries].reverse(),
    });

    expect(result.branchId).toBe(branchId);
    expect(result.entries.map((entry) => entry.dayOfWeek)).toEqual([1, 2]);
    expect(result.entries[1]).toMatchObject({ breakStartTime: '15:00', breakEndTime: '16:00' });
  });

  it('a day omitted from entries is removed on the next replace', async () => {
    const { useCase, branchId } = await setupWithBranch();
    await useCase.execute({ actor: baseActor(), restaurantId, branchId, entries: validEntries });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      entries: [validEntries[0]],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].dayOfWeek).toBe(1);
  });

  it('rejects a duplicate dayOfWeek within the same request without persisting any change', async () => {
    const { useCase, branchId, branchWorkingHoursRepository } = await setupWithBranch();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        branchId,
        entries: [validEntries[0], { ...validEntries[0] }],
      }),
    ).rejects.toBeInstanceOf(InvalidBranchWorkingHoursException);

    const persisted = await branchWorkingHoursRepository.findAllByBranchId(
      BranchId.create(branchId),
    );
    expect(persisted).toHaveLength(0);
  });

  it('rejects an entry with an invalid time format without persisting any change', async () => {
    const { useCase, branchId, branchWorkingHoursRepository } = await setupWithBranch();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        branchId,
        entries: [{ ...validEntries[0], openingTime: '9am' }],
      }),
    ).rejects.toBeInstanceOf(InvalidBranchWorkingHoursException);

    const persisted = await branchWorkingHoursRepository.findAllByBranchId(
      BranchId.create(branchId),
    );
    expect(persisted).toHaveLength(0);
  });

  it('accepts an empty entries array (no override)', async () => {
    const { useCase, branchId } = await setupWithBranch();
    await useCase.execute({ actor: baseActor(), restaurantId, branchId, entries: validEntries });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId,
      entries: [],
    });

    expect(result.entries).toEqual([]);
  });

  it('writes exactly one audit log entry describing the update', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const context = await (async () => {
      const c = createUseCase({ auditLogWriter });
      await c.restaurantRepository.save(buildRestaurant(restaurantId));
      const branchId = await seedBranch(c.branchRepository, c.restaurantRepository);
      return { ...c, branchId };
    })();

    await context.useCase.execute({
      actor: baseActor(),
      restaurantId,
      branchId: context.branchId,
      entries: validEntries,
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'branch.working_hours.updated',
      targetType: 'Branch',
      targetId: context.branchId,
      organizationId,
      correlationId: 'corr-1',
    });
  });

  it('throws BranchNotFoundException when updating via a different restaurant (IDOR)', async () => {
    const { useCase, branchId } = await setupWithBranch();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: otherRestaurantId,
        branchId,
        entries: validEntries,
      }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        branchId: '66666666-6666-4666-8666-666666666666',
        entries: validEntries,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
