import { ListRestaurantEmployeesUseCase } from './list-restaurant-employees.use-case';
import { ListRestaurantRolesUseCase } from './list-restaurant-roles.use-case';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus, RoleScope } from '@modules/authorization/domain/enums/authorization.enums';
import { Role } from '@modules/authorization/domain/entities/role.entity';
import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { InMemoryEmployeeRepository } from '../../../../../test/authorization/support/in-memory-employee.repository';
import { InMemoryRoleRepository } from '../../../../../test/authorization/support/in-memory-role.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';

describe('Restaurant staff listing', () => {
  const now = new Date('2026-07-20T12:00:00.000Z');
  const restaurantId = '44444444-4444-4444-8444-444444444444';
  const otherRestaurantId = '88888888-8888-4888-8888-888888888888';
  const unknownRestaurantId = '99999999-9999-4999-8999-999999999999';
  const roleId = '55555555-5555-4555-8555-555555555555';

  function employee(
    id: string,
    restaurant: string,
    createdAt: Date,
    deletedAt: Date | null = null,
  ) {
    return Employee.create({
      id,
      restaurantId: restaurant,
      roleId,
      userId: null,
      permissionsVersion: 1,
      firstName: 'Jane',
      lastName: 'Doe',
      email: `${id.slice(0, 4)}@example.com`,
      phone: null,
      status: EmployeeStatus.Invited,
      assignedBranchIds: [],
      createdAt,
      updatedAt: createdAt,
      deletedAt,
    });
  }

  function role(id: string, name: string, slug: string, scope: RoleScope) {
    return Role.create({
      id,
      name,
      slug,
      description: name,
      scope,
      createdAt: now,
      updatedAt: now,
    });
  }

  async function build() {
    const restaurantRepository = new InMemoryRestaurantRepository();
    for (const id of [restaurantId, otherRestaurantId]) {
      await restaurantRepository.save(
        Restaurant.create({
          id,
          organizationId: 'org-1',
          name: 'The Old Mill',
          slug: `old-mill-${id.slice(0, 4)}`,
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
    }

    const employeeRepository = new InMemoryEmployeeRepository();
    await employeeRepository.save(
      employee(
        '66666666-6666-4666-8666-666666666666',
        restaurantId,
        new Date('2026-07-02T00:00:00Z'),
      ),
    );
    await employeeRepository.save(
      employee(
        '77777777-7777-4777-8777-777777777777',
        restaurantId,
        new Date('2026-07-01T00:00:00Z'),
      ),
    );
    await employeeRepository.save(
      employee('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', restaurantId, now, now),
    );
    await employeeRepository.save(
      employee('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', otherRestaurantId, now),
    );

    const roleRepository = new InMemoryRoleRepository();
    await roleRepository.save(role(roleId, 'Restaurant Manager', 'manager', RoleScope.Restaurant));
    await roleRepository.save(
      role(
        'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        'Receptionist',
        'receptionist',
        RoleScope.Restaurant,
      ),
    );
    await roleRepository.save(
      role(
        'dddddddd-dddd-4ddd-8ddd-dddddddddddd',
        'Platform Support',
        'platform-support',
        RoleScope.Platform,
      ),
    );

    return {
      employees: new ListRestaurantEmployeesUseCase(employeeRepository, restaurantRepository),
      roles: new ListRestaurantRolesUseCase(roleRepository, restaurantRepository),
    };
  }

  it("lists only this restaurant's non-removed employees, oldest first", async () => {
    const { employees } = await build();
    const result = await employees.execute({ restaurantId });
    expect(result.map((e) => e.employeeId)).toEqual([
      '77777777-7777-4777-8777-777777777777',
      '66666666-6666-4666-8666-666666666666',
    ]);
    expect(result[0]).toMatchObject({ restaurantId, roleId, status: EmployeeStatus.Invited });
  });

  it('returns not found for an unknown restaurant', async () => {
    const { employees, roles } = await build();
    await expect(employees.execute({ restaurantId: unknownRestaurantId })).rejects.toThrow(
      RestaurantNotFoundException,
    );
    await expect(roles.execute({ restaurantId: unknownRestaurantId })).rejects.toThrow(
      RestaurantNotFoundException,
    );
  });

  it('lists restaurant-scoped roles by name, without platform roles', async () => {
    const { roles } = await build();
    const result = await roles.execute({ restaurantId });
    expect(result).toEqual([
      {
        roleId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
        name: 'Receptionist',
        slug: 'receptionist',
        description: 'Receptionist',
      },
      { roleId, name: 'Restaurant Manager', slug: 'manager', description: 'Restaurant Manager' },
    ]);
  });
});
