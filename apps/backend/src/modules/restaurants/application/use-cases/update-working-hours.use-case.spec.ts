import { UpdateWorkingHoursUseCase } from './update-working-hours.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidWorkingHoursException } from '../../domain/exceptions/invalid-working-hours.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryWorkingHoursRepository } from '../../../../../test/restaurants/support/in-memory-working-hours.repository';

describe('UpdateWorkingHoursUseCase', () => {
  const fixedNow = new Date('2026-07-16T12:00:00.000Z');

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: '33333333-3333-4333-8333-333333333333',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function seedRestaurant(
    restaurantRepository: InMemoryRestaurantRepository,
    restaurantSettingsRepository: InMemoryRestaurantSettingsRepository,
  ): Promise<string> {
    const {
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      restaurantUsageRepository,
    } = createPermissiveSubscriptionFixture(
      '33333333-3333-4333-8333-333333333333',
      {
        planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        usageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      },
      fixedNow,
    );
    const createUseCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      subscriptionUsageRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      new CollectingEventPublisher(),
      new ImmediateUnitOfWork(),
    );
    const result = await createUseCase.execute({
      actor: baseActor(),
      name: 'The Old Mill',
      description: null,
      cuisineType: null,
      priceLevel: null,
    });
    return result.restaurantId;
  }

  function createUseCase(overrides?: { auditLogWriter?: CollectingAuditLogWriter }) {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const workingHoursRepository = new InMemoryWorkingHoursRepository();
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new UpdateWorkingHoursUseCase(
      restaurantRepository,
      workingHoursRepository,
      new FixedClock(fixedNow),
      new UuidGenerator(),
      auditLogWriter,
    );
    return {
      useCase,
      restaurantRepository,
      restaurantSettingsRepository,
      workingHoursRepository,
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

  it('persists the submitted week and returns it sorted by dayOfWeek', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      entries: [...validEntries].reverse(),
    });

    expect(result.restaurantId).toBe(restaurantId);
    expect(result.entries).toHaveLength(2);
    expect(result.entries.map((entry) => entry.dayOfWeek)).toEqual([1, 2]);
    expect(result.entries[1]).toMatchObject({
      dayOfWeek: 2,
      breakStartTime: '15:00',
      breakEndTime: '16:00',
    });
  });

  it('a day omitted from entries is removed (closed) on the next replace', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({ actor: baseActor(), restaurantId, entries: validEntries });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      entries: [validEntries[0]],
    });

    expect(result.entries).toHaveLength(1);
    expect(result.entries[0].dayOfWeek).toBe(1);
  });

  it('rejects a duplicate dayOfWeek within the same request without persisting any change', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository, workingHoursRepository } =
      createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        entries: [validEntries[0], { ...validEntries[0] }],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkingHoursException);

    const persisted = await workingHoursRepository.findAllByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    expect(persisted).toHaveLength(0);
  });

  it('rejects an entry with an invalid time format without persisting any change', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository, workingHoursRepository } =
      createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        entries: [{ ...validEntries[0], openingTime: '9am' }],
      }),
    ).rejects.toBeInstanceOf(InvalidWorkingHoursException);

    const persisted = await workingHoursRepository.findAllByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    expect(persisted).toHaveLength(0);
  });

  it('accepts an empty entries array (fully closed week)', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({ actor: baseActor(), restaurantId, entries: validEntries });

    const result = await useCase.execute({ actor: baseActor(), restaurantId, entries: [] });

    expect(result.entries).toEqual([]);
  });

  it('writes exactly one audit log entry describing the update', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase({
      auditLogWriter,
    });
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      entries: validEntries,
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'restaurant.working_hours.updated',
      targetType: 'Restaurant',
      targetId: restaurantId,
      organizationId: baseActor().organizationId,
      correlationId: 'corr-1',
    });
  });

  it('throws RestaurantNotFoundException when the restaurant does not exist', async () => {
    const { useCase } = createUseCase();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
        entries: validEntries,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
