import { UpdateRestaurantSettingsUseCase } from './update-restaurant-settings.use-case';
import { CreateRestaurantUseCase } from './create-restaurant.use-case';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidRestaurantSettingsException } from '../../domain/exceptions/invalid-restaurant-settings.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';

describe('UpdateRestaurantSettingsUseCase', () => {
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
    const createUseCase = new CreateRestaurantUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
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
    const auditLogWriter = overrides?.auditLogWriter ?? new CollectingAuditLogWriter();
    const useCase = new UpdateRestaurantSettingsUseCase(
      restaurantRepository,
      restaurantSettingsRepository,
      new FixedClock(fixedNow),
      auditLogWriter,
    );
    return { useCase, restaurantRepository, restaurantSettingsRepository, auditLogWriter };
  }

  const validPatch = {
    reservationIntervalMinutes: 45,
    maxGuestsPerReservation: 12,
    cancellationWindowMinutes: 120,
    pendingReservationTimeoutMinutes: 30,
    defaultReservationDurationMinutes: 120,
    autoApproval: true,
    timezone: 'Europe/Istanbul',
    defaultCurrency: 'TRY',
    reservationReminderMinutesBefore: 90,
    lateArrivalGraceMinutes: 20,
  };

  it('replaces every settings field and returns the updated result', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      ...validPatch,
    });

    expect(result).toMatchObject({ restaurantId, ...validPatch });
  });

  it('allows clearing defaultCurrency back to null', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);
    await useCase.execute({ actor: baseActor(), restaurantId, ...validPatch });

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      ...validPatch,
      defaultCurrency: null,
    });

    expect(result.defaultCurrency).toBeNull();
  });

  it('rejects an out-of-bounds reservationIntervalMinutes without persisting the change', async () => {
    const { useCase, restaurantRepository, restaurantSettingsRepository } = createUseCase();
    const restaurantId = await seedRestaurant(restaurantRepository, restaurantSettingsRepository);

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        ...validPatch,
        reservationIntervalMinutes: 1,
      }),
    ).rejects.toBeInstanceOf(InvalidRestaurantSettingsException);

    const persisted = await restaurantSettingsRepository.findByRestaurantId(
      RestaurantId.create(restaurantId),
    );
    expect(persisted?.reservationIntervalMinutes).toBe(30);
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
      ...validPatch,
      correlationId: 'corr-1',
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: 'user-1',
      actorType: 'User',
      action: 'restaurant.settings.updated',
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
        ...validPatch,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
