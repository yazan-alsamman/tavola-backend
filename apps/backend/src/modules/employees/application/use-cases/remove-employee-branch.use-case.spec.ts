import { RemoveEmployeeFromBranchUseCase } from './remove-employee-branch.use-case';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { FixedClock } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';

describe('RemoveEmployeeFromBranchUseCase', () => {
  const fixedNow = new Date('2026-07-20T12:00:00.000Z');
  const organizationId = '33333333-3333-4333-8333-333333333333';
  const restaurantId = '44444444-4444-4444-8444-444444444444';
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

  async function build(assignedBranchIds: string[] = [branchId]) {
    const employeeRepository = new InMemoryEmployeeRepository();
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
        assignedBranchIds,
        createdAt: fixedNow,
        updatedAt: fixedNow,
        deletedAt: null,
      }),
    );

    const useCase = new RemoveEmployeeFromBranchUseCase(
      employeeRepository,
      restaurantRepository,
      new FixedClock(fixedNow),
    );
    return { useCase };
  }

  it('removes the branch, restoring restaurant-wide scope when it was the only one', async () => {
    const { useCase } = await build([branchId]);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      employeeId,
      branchId,
    });

    expect(result.assignedBranchIds).toEqual([]);
  });

  it('is idempotent when the branch is not currently assigned', async () => {
    const { useCase } = await build([]);

    const result = await useCase.execute({
      actor: baseActor(),
      restaurantId,
      employeeId,
      branchId,
    });

    expect(result.assignedBranchIds).toEqual([]);
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
        restaurantId: '99999999-9999-4999-8999-999999999998',
        employeeId,
        branchId,
      }),
    ).rejects.toBeInstanceOf(RestaurantNotFoundException);
  });
});
