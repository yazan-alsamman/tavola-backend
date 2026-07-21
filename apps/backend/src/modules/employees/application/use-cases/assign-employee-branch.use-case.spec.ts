import { AssignEmployeeToBranchUseCase } from './assign-employee-branch.use-case';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { InMemoryBranchRepository } from '../../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';

describe('AssignEmployeeToBranchUseCase', () => {
  const fixedNow = new Date('2026-07-20T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '88888888-8888-4888-8888-888888888888';
  const employeeId = '66666666-6666-4666-8666-666666666666';
  const branchId = '77777777-7777-4777-8777-777777777777';
  const roleId = '55555555-5555-4555-8555-555555555555';

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
    const branchRepository = new InMemoryBranchRepository();
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

    await branchRepository.save(
      Branch.create({
        id: branchId,
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
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    await employeeRepository.save(
      Employee.create({
        id: employeeId,
        restaurantId,
        roleId,
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

    const useCase = new AssignEmployeeToBranchUseCase(
      employeeRepository,
      branchRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
    );

    return { useCase, employeeRepository, restaurantRepository };
  }

  it('assigns a branch, narrowing the employee out of restaurant-wide scope', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      employeeId,
      branchId,
    });

    expect(result.assignedBranchIds).toEqual([branchId]);
  });

  it('is idempotent when the branch is already assigned', async () => {
    const { useCase } = await build();

    await useCase.execute({ actor: baseActor(), restaurantId, employeeId, branchId });
    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      employeeId,
      branchId,
    });

    expect(result.assignedBranchIds).toEqual([branchId]);
  });

  it('throws EmployeeNotFoundException for an unknown employee', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId,
        employeeId: '99999999-9999-4999-8999-999999999999',
        branchId,
      }),
    ).rejects.toBeInstanceOf(EmployeeNotFoundException);
  });

  it('throws RestaurantNotFoundException for an unknown restaurant', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: otherRestaurantId,
        employeeId,
        branchId,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });

  it('throws EmployeeNotFoundException when the employee belongs to a different (but real) restaurant (IDOR)', async () => {
    const { useCase, restaurantRepository } = await build();

    await restaurantRepository.save(
      Restaurant.create({
        id: otherRestaurantId,
        organizationId: '99999999-9999-4999-8999-999999999997',
        name: 'Another Restaurant',
        slug: 'another-restaurant',
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

    await expect(
      useCase.execute({
        actor: baseActor(),
        restaurantId: otherRestaurantId,
        employeeId,
        branchId,
      }),
    ).rejects.toBeInstanceOf(EmployeeNotFoundException);
  });
});
