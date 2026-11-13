import {
  CreateBranchClosureUseCase,
  DeleteBranchClosureUseCase,
  ListBranchClosuresUseCase,
} from './branch-closures.use-cases';
import { SetBranchPausedUseCase } from './set-branch-paused.use-case';
import { BranchAccessService } from '../services/branch-access.service';
import { Branch } from '../../domain/entities/branch.entity';
import { BranchSubscriptionStatus } from '../../domain/enums/branch.enums';
import { BranchClosureNotFoundException } from '../../domain/exceptions/branch-closure-not-found.exception';
import { InvalidBranchClosureException } from '../../domain/exceptions/invalid-branch-closure.exception';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingAuditLogWriter,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryBranchClosureRepository } from '../../../../../test/branches/support/in-memory-branch-closure.repository';

describe('Branch closures and pause (ADR-053)', () => {
  // 2026-11-14 01:00 in Damascus (UTC+3) is still 2026-11-13 in UTC.
  const now = new Date('2026-11-13T22:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const branchId = '66666666-6666-4666-8666-666666666661';
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

  async function setup() {
    const restaurants = new InMemoryRestaurantRepository();
    const branches = new InMemoryBranchRepository();
    const closures = new InMemoryBranchClosureRepository();
    await restaurants.save(
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
    await branches.save(
      Branch.create({
        id: branchId,
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
      }),
    );
    const access = new BranchAccessService(restaurants, branches);
    const clock = new FixedClock(now);
    const audit = new CollectingAuditLogWriter();
    return {
      branches,
      closures,
      audit,
      list: new ListBranchClosuresUseCase(access, closures, clock),
      create: new CreateBranchClosureUseCase(
        access,
        closures,
        clock,
        new SequentialIdGenerator([
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
          'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        ]),
        audit,
      ),
      remove: new DeleteBranchClosureUseCase(access, closures, clock, audit),
      setPaused: new SetBranchPausedUseCase(access, branches, clock, audit),
    };
  }

  it('creates a closure and lists only those that have not ended in branch-local time', async () => {
    const { create, list, audit } = await setup();
    await create.execute({
      actor,
      restaurantId,
      branchId,
      startDate: '2026-11-13',
      endDate: '2026-11-13',
      reason: null,
    });
    const upcoming = await create.execute({
      actor,
      restaurantId,
      branchId,
      startDate: '2026-12-24',
      endDate: '2026-12-26',
      reason: '  Holidays  ',
    });

    expect(upcoming.reason).toBe('Holidays');
    const listed = await list.execute({ actor, restaurantId, branchId });
    expect(listed.map((closure) => closure.startDate)).toEqual(['2026-12-24']);
    expect(audit.entries.at(-1)?.action).toBe('branch.closure.created');
  });

  it('rejects an end date before the start date', async () => {
    const { create } = await setup();
    await expect(
      create.execute({
        actor,
        restaurantId,
        branchId,
        startDate: '2026-12-26',
        endDate: '2026-12-24',
        reason: null,
      }),
    ).rejects.toBeInstanceOf(InvalidBranchClosureException);
  });

  it('removes a closure and 404s for an unknown one', async () => {
    const { create, remove, list } = await setup();
    const closure = await create.execute({
      actor,
      restaurantId,
      branchId,
      startDate: '2026-12-24',
      endDate: '2026-12-24',
      reason: null,
    });

    await remove.execute({ actor, restaurantId, branchId, closureId: closure.closureId });

    expect(await list.execute({ actor, restaurantId, branchId })).toEqual([]);
    await expect(
      remove.execute({ actor, restaurantId, branchId, closureId: closure.closureId }),
    ).rejects.toBeInstanceOf(BranchClosureNotFoundException);
  });

  it('pauses and resumes a branch, auditing each change once', async () => {
    const { setPaused, audit } = await setup();

    const paused = await setPaused.execute({ actor, restaurantId, branchId, paused: true });
    await setPaused.execute({ actor, restaurantId, branchId, paused: true });
    const resumed = await setPaused.execute({ actor, restaurantId, branchId, paused: false });

    expect(paused.subscriptionStatus).toBe(BranchSubscriptionStatus.Paused);
    expect(resumed.subscriptionStatus).toBe(BranchSubscriptionStatus.Active);
    expect(audit.entries.map((entry) => entry.action)).toEqual(['branch.paused', 'branch.resumed']);
  });

  it('404s for a branch of another restaurant', async () => {
    const { list } = await setup();
    await expect(
      list.execute({ actor, restaurantId, branchId: '66666666-6666-4666-8666-666666666669' }),
    ).rejects.toBeInstanceOf(BranchNotFoundException);
  });
});
