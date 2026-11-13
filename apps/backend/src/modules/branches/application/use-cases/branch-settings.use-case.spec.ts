import { GetBranchSettingsUseCase } from './get-branch-settings.use-case';
import { UpdateBranchSettingsUseCase } from './update-branch-settings.use-case';
import { BranchAccessService } from '../services/branch-access.service';
import { BranchSettingsAccessService } from '../services/branch-settings-access.service';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { Branch } from '../../domain/entities/branch.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { InvalidRestaurantSettingsException } from '@modules/restaurants/domain/exceptions/invalid-restaurant-settings.exception';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  FixedClock,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';

describe('Branch settings (ADR-051)', () => {
  const now = new Date('2026-11-13T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchA = '66666666-6666-4666-8666-666666666661';
  const branchB = '66666666-6666-4666-8666-666666666662';
  const actor = {
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: 'user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId,
    orgRole: 'Owner',
    permissionsVersion: 1,
  };
  const rules = {
    reservationIntervalMinutes: 15,
    maxGuestsPerReservation: 8,
    cancellationWindowMinutes: 120,
    pendingReservationTimeoutMinutes: 30,
    defaultReservationDurationMinutes: 60,
    autoApproval: true,
    reservationReminderMinutesBefore: 30,
    lateArrivalGraceMinutes: 10,
  };

  function branch(id: string): Branch {
    return Branch.create({
      id,
      restaurantId,
      city: 'Damascus',
      district: null,
      address: '1 Straight St',
      latitude: null,
      longitude: null,
      countryCode: 'SY',
      currency: 'SYP',
      timezone: 'Asia/Damascus',
      phone: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });
  }

  async function setup() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const branchRepository = new InMemoryBranchRepository();
    const settingsRepository = new InMemoryRestaurantSettingsRepository();
    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'Naranj',
        slug: 'naranj',
        logoId: null,
        coverImageId: null,
        description: null,
        cuisineType: null,
        averageRating: null,
        priceLevel: null,
        status: RestaurantStatus.Active,
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      }),
    );
    await branchRepository.save(branch(branchA));
    await branchRepository.save(branch(branchB));
    await settingsRepository.save(
      RestaurantSettings.createDefault('77777777-7777-4777-8777-777777777777', restaurantId, now),
    );
    const access = new BranchSettingsAccessService(
      new BranchAccessService(restaurantRepository, branchRepository),
      settingsRepository,
    );
    const auditLogWriter = new CollectingAuditLogWriter();
    return {
      settingsRepository,
      auditLogWriter,
      get: new GetBranchSettingsUseCase(access),
      update: new UpdateBranchSettingsUseCase(
        access,
        settingsRepository,
        new FixedClock(now),
        auditLogWriter,
      ),
    };
  }

  it("returns the restaurant's rules for a branch that never saved its own", async () => {
    const { get } = await setup();
    const result = await get.execute({ actor, restaurantId, branchId: branchA });
    expect(result.branchId).toBe(branchA);
    expect(result.maxGuestsPerReservation).toBe(20);
  });

  it('saves rules for one branch only', async () => {
    const { get, update, settingsRepository, auditLogWriter } = await setup();

    const saved = await update.execute({ actor, restaurantId, branchId: branchA, ...rules });

    expect(saved).toMatchObject({ branchId: branchA, ...rules });
    expect((await get.execute({ actor, restaurantId, branchId: branchB })).autoApproval).toBe(
      false,
    );
    const forBooking = await settingsRepository.findForBranch(
      RestaurantId.create(restaurantId),
      BranchId.create(branchA),
    );
    expect(forBooking?.maxGuestsPerReservation).toBe(8);
    expect(auditLogWriter.entries.at(-1)?.action).toBe('branch.settings.updated');
  });

  it('rejects values the restaurant rules would reject', async () => {
    const { update } = await setup();
    await expect(
      update.execute({
        actor,
        restaurantId,
        branchId: branchA,
        ...rules,
        reservationIntervalMinutes: 0,
      }),
    ).rejects.toBeInstanceOf(InvalidRestaurantSettingsException);
  });

  it('404s for a branch of another restaurant', async () => {
    const { get } = await setup();
    await expect(
      get.execute({ actor, restaurantId, branchId: '66666666-6666-4666-8666-666666666669' }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });
});
