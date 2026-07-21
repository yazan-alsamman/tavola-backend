import { RemoveEmployeeUseCase } from './remove-employee.use-case';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { CannotRemoveLastManagerException } from '@modules/authorization/domain/exceptions/cannot-remove-last-manager.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus, RoleScope } from '@modules/authorization/domain/enums/authorization.enums';
import { Role } from '@modules/authorization/domain/entities/role.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { EmployeeId } from '@shared/domain/value-objects/identifiers.vo';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { InMemoryRoleRepository } from '../../../../../test/authorization/support/in-memory-role.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';

describe('RemoveEmployeeUseCase', () => {
  const fixedNow = new Date('2026-07-20T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const managerRoleId = '55555555-5555-4555-8555-555555555555';
  const receptionistRoleId = '77777777-7777-4777-8777-777777777777';
  const employeeId = '66666666-6666-4666-8666-666666666666';
  const secondManagerId = '88888888-8888-4888-8888-888888888888';

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

  function makeEmployee(id: string, roleId: string, email: string) {
    return Employee.create({
      id,
      restaurantId,
      roleId,
      userId: null,
      permissionsVersion: 1,
      firstName: 'Jane',
      lastName: 'Doe',
      email,
      phone: null,
      status: EmployeeStatus.Active,
      assignedBranchIds: [],
      createdAt: fixedNow,
      updatedAt: fixedNow,
      deletedAt: null,
    });
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

    const useCase = new RemoveEmployeeUseCase(
      employeeRepository,
      roleRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
    );

    return { useCase, employeeRepository };
  }

  it('soft-deletes a non-manager employee', async () => {
    const { useCase, employeeRepository } = await build();
    await employeeRepository.save(makeEmployee(employeeId, receptionistRoleId, 'r@example.com'));

    await useCase.execute({ actor: baseActor(), restaurantId, employeeId });

    const stored = await employeeRepository.findById(EmployeeId.create(employeeId));
    expect(stored?.deletedAt).not.toBeNull();
  });

  it('soft-deletes a manager when another manager remains', async () => {
    const { useCase, employeeRepository } = await build();
    await employeeRepository.save(makeEmployee(employeeId, managerRoleId, 'm1@example.com'));
    await employeeRepository.save(makeEmployee(secondManagerId, managerRoleId, 'm2@example.com'));

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, employeeId }),
    ).resolves.toBeDefined();
  });

  it('throws CannotRemoveLastManagerException when removing the last manager', async () => {
    const { useCase, employeeRepository } = await build();
    await employeeRepository.save(makeEmployee(employeeId, managerRoleId, 'm1@example.com'));

    await expect(
      useCase.execute({ actor: baseActor(), restaurantId, employeeId }),
    ).rejects.toBeInstanceOf(CannotRemoveLastManagerException);
  });

  it('throws EmployeeNotFoundException for an unknown employee', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        employeeId: '99999999-9999-4999-8999-999999999999',
      }),
    ).rejects.toBeInstanceOf(EmployeeNotFoundException);
  });

  it('throws RestaurantNotFoundException for an unknown restaurant', async () => {
    const { useCase, employeeRepository } = await build();
    await employeeRepository.save(makeEmployee(employeeId, receptionistRoleId, 'r@example.com'));

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: '99999999-9999-4999-8999-999999999998',
        employeeId,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
