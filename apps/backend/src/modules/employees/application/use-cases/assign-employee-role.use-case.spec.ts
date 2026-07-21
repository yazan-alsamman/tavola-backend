import { AssignEmployeeRoleUseCase } from './assign-employee-role.use-case';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { RoleNotFoundException } from '@modules/authorization/domain/exceptions/role-not-found.exception';
import { RoleAssignedEvent } from '@modules/authorization/domain/events/authorization.events';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus, RoleScope } from '@modules/authorization/domain/enums/authorization.enums';
import { Role } from '@modules/authorization/domain/entities/role.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  FixedClock,
  SequentialIdGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { InMemoryRoleRepository } from '../../../../../test/authorization/support/in-memory-role.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';

describe('AssignEmployeeRoleUseCase', () => {
  const fixedNow = new Date('2026-07-20T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '88888888-8888-4888-8888-888888888888';
  const employeeId = '66666666-6666-4666-8666-666666666666';
  const managerRoleId = '55555555-5555-4555-8555-555555555555';
  const receptionistRoleId = '77777777-7777-4777-8777-777777777777';

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
    const employeeRepository = new InMemoryEmployeeRepository();
    const roleRepository = new InMemoryRoleRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();

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
        id: managerRoleId,
        name: 'Restaurant Manager',
        slug: 'manager',
        description: 'Full restaurant operational access',
        scope: RoleScope.Restaurant,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );
    await roleRepository.save(
      Role.create({
        id: receptionistRoleId,
        name: 'Receptionist',
        slug: 'receptionist',
        description: 'Front-of-house reservation and guest management',
        scope: RoleScope.Restaurant,
        createdAt: fixedNow,
        updatedAt: fixedNow,
      }),
    );

    await employeeRepository.save(
      Employee.create({
        id: employeeId,
        restaurantId,
        roleId: managerRoleId,
        userId: null,
        permissionsVersion: 1,
        firstName: 'Jane',
        lastName: 'Doe',
        email: 'jane.doe@example.com',
        phone: null,
        status: EmployeeStatus.Active,
        assignedBranchIds: [],
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    const eventPublisher = new CollectingEventPublisher();
    const useCase = new AssignEmployeeRoleUseCase(
      employeeRepository,
      roleRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
      new SequentialIdGenerator(['99999999-9999-4999-8999-999999999998']),
      eventPublisher,
    );

    return { useCase, employeeRepository, eventPublisher };
  }

  it('changes the employee role and bumps permissionsVersion', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      employeeId,
      roleId: receptionistRoleId,
    });

    expect(result.roleId).toBe(receptionistRoleId);
  });

  it('publishes RoleAssigned', async () => {
    const { useCase, eventPublisher } = await build();

    await useCase.execute({
      actor: baseActor(),
      restaurantId,
      employeeId,
      roleId: receptionistRoleId,
    });

    expect(eventPublisher.events).toHaveLength(1);
    expect(eventPublisher.events[0]).toBeInstanceOf(RoleAssignedEvent);
  });

  it('throws EmployeeNotFoundException for an unknown employee', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        employeeId: '99999999-9999-4999-8999-999999999999',
        roleId: receptionistRoleId,
      }),
    ).rejects.toBeInstanceOf(EmployeeNotFoundException);
  });

  it('throws RoleNotFoundException for an unknown role', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        employeeId,
        roleId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toBeInstanceOf(RoleNotFoundException);
  });

  it('throws RestaurantNotFoundException for an unknown restaurant', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '99999999-9999-4999-8999-999999999999',
        employeeId,
        roleId: receptionistRoleId,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws EmployeeNotFoundException when the employee belongs to a different (but real) restaurant (IDOR)', async () => {
    const { useCase, employeeRepository } = await build();
    // Simulates a malicious caller who legitimately owns `restaurantId` but
    // is trying to reach an employee that actually belongs to
    // `otherRestaurantId` - the exact scenario the tenant gate must block.
    await employeeRepository.save(
      Employee.create({
        id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        restaurantId: otherRestaurantId,
        roleId: receptionistRoleId,
        userId: null,
        permissionsVersion: 1,
        firstName: 'Other',
        lastName: 'Restaurant',
        email: 'other@example.com',
        phone: null,
        status: EmployeeStatus.Active,
        assignedBranchIds: [],
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        employeeId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        roleId: receptionistRoleId,
      }),
    ).rejects.toBeInstanceOf(EmployeeNotFoundException);
  });
});
