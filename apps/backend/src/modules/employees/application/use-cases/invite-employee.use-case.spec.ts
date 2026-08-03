import { InviteEmployeeUseCase } from './invite-employee.use-case';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { RoleNotFoundException } from '@modules/authorization/domain/exceptions/role-not-found.exception';
import { EmployeeEmailAlreadyExistsException } from '@modules/authorization/domain/exceptions/employee-email-already-exists.exception';
import { EmployeeInvitedEvent } from '@modules/authorization/domain/events/authorization.events';
import { EmployeeStatus, RoleScope } from '@modules/authorization/domain/enums/authorization.enums';
import { Role } from '@modules/authorization/domain/entities/role.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { EmployeeId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { InMemoryRoleRepository } from '../../../../../test/authorization/support/in-memory-role.repository';
import { RestaurantUsage } from '@modules/restaurants/domain/entities/restaurant-usage.entity';
import { createPermissiveSubscriptionFixture } from '../../../../../test/subscriptions/support/permissive-subscription-fixture';

describe('InviteEmployeeUseCase', () => {
  const fixedNow = new Date('2026-07-20T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const roleId = '55555555-5555-4555-8555-555555555555';
  const newEmployeeId = '66666666-6666-4666-8666-666666666666';

  function baseActor() {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'owner-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    const roleRepository = new InMemoryRoleRepository();
    const employeeRepository = new InMemoryEmployeeRepository();

    await restaurantRepository.save(
      Restaurant.create({
        id: restaurantId,
        organizationId,
        name: 'The Old Mill',
        slug: 'the-old-mill',
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
      }),
    );

    await roleRepository.save(
      Role.create({
        id: roleId,
        name: 'Restaurant Manager',
        slug: 'manager',
        description: 'Full restaurant operational access',
        scope: RoleScope.Restaurant,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );

    const { subscriptionRepository, subscriptionPlanRepository, restaurantUsageRepository } =
      createPermissiveSubscriptionFixture(
        organizationId,
        {
          planId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
          subscriptionId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
          usageId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        },
        fixedNow,
      );
    await restaurantUsageRepository.create(
      RestaurantUsage.create({
        id: 'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        restaurantId,
        now: fixedNow,
      }),
    );

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new InviteEmployeeUseCase(
      employeeRepository,
      roleRepository,
      restaurantRepository,
      restaurantUsageRepository,
      subscriptionRepository,
      subscriptionPlanRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator([newEmployeeId, '77777777-7777-4777-8777-777777777777']),
      eventPublisher,
      new ImmediateUnitOfWork(),
    );

    return { useCase, employeeRepository, eventPublisher };
  }

  it('invites a new employee as Invited, unlinked to any User', async () => {
    const { useCase, employeeRepository } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      roleId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'Jane.Doe@Example.com',
      phone: null,
    });

    expect(result.status).toBe(EmployeeStatus.Invited);
    expect(result.userId).toBeNull();
    expect(result.email).toBe('jane.doe@example.com');
    expect(result.assignedBranchIds).toEqual([]);

    const stored = await employeeRepository.findById(EmployeeId.create(newEmployeeId));
    expect(stored).not.toBeNull();
  });

  it('publishes EmployeeInvited', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      roleId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      phone: null,
    });

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(EmployeeInvitedEvent);
  });

  it('throws RestaurantNotFoundException for an unknown restaurant', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '99999999-9999-4999-8999-999999999999',
        roleId,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: null,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws RoleNotFoundException for an unknown role', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        roleId: '99999999-9999-4999-8999-999999999999',
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: null,
      }),
    ).rejects.toBeInstanceOf(RoleNotFoundException);
  });

  it('throws EmployeeEmailAlreadyExistsException for a duplicate email within the same restaurant', async () => {
    const { useCase } = await build();

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      roleId,
      firstName: 'Jane',
      lastName: 'Doe',
      email: 'jane.doe@example.com',
      phone: null,
    });

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        roleId,
        firstName: 'Jane',
        lastName: 'Impostor',
        email: 'jane.doe@example.com',
        phone: null,
      }),
    ).rejects.toBeInstanceOf(EmployeeEmailAlreadyExistsException);
  });
});
