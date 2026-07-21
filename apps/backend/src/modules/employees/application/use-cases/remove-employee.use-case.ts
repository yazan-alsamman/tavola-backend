import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EmployeeId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK } from '@modules/authentication/domain/tokens/authentication.tokens';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { CannotRemoveLastManagerException } from '@modules/authorization/domain/exceptions/cannot-remove-last-manager.exception';
import {
  EmployeeRepository,
  RoleRepository,
} from '@modules/authorization/domain/repositories/authorization.repositories';
import {
  EMPLOYEE_REPOSITORY,
  ROLE_REPOSITORY,
} from '@modules/authorization/application/tokens/authorization.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { toEmployeeResult } from '../mappers/employee-result.mapper';
import { RemoveEmployeeCommand } from '../dto/remove-employee.command';
import { EmployeeResult } from '../dto/employee.result';

/** Slug of the seeded `Restaurant Manager` role (`prisma/seed.ts`). */
const MANAGER_ROLE_SLUG = 'manager';

/**
 * Phase 7.0 - "Remove Employee" is a soft delete only (`Employee.softDelete`,
 * ADR-010 convention; TASKS.md's Phase 7.0 decision note item 1 - no
 * `Deactivated` status flip). Enforces "cannot remove the last Manager"
 * (AUTHORIZATION_ARCHITECTURE.md §19, `EmployeePolicy` responsibility,
 * decision note item 4) as a domain/use-case-layer invariant, not a policy
 * class.
 */
@Injectable()
export class RemoveEmployeeUseCase {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepository: RoleRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: RemoveEmployeeCommand): Promise<EmployeeResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const employeeId = EmployeeId.create(command.employeeId);

    // Tenant isolation gate - see AssignEmployeeRoleUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const employee = await this.employeeRepository.findByIdAndRestaurantId(
      employeeId,
      restaurantId,
    );
    if (employee === null) {
      throw new EmployeeNotFoundException();
    }

    const role = await this.roleRepository.findById(employee.roleId);
    if (role !== null && role.slug.value === MANAGER_ROLE_SLUG) {
      const managerCount = await this.employeeRepository.countActiveByRestaurantIdAndRoleId(
        restaurantId,
        employee.roleId,
      );
      if (managerCount <= 1) {
        throw new CannotRemoveLastManagerException();
      }
    }

    const now = this.clock.now();
    const removed = employee.softDelete(now);
    await this.employeeRepository.save(removed);

    return toEmployeeResult(removed);
  }
}
