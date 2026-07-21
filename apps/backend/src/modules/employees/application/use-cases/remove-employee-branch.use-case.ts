import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { EmployeeId, RestaurantId, BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK } from '@modules/authentication/domain/tokens/authentication.tokens';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { EmployeeRepository } from '@modules/authorization/domain/repositories/authorization.repositories';
import { EMPLOYEE_REPOSITORY } from '@modules/authorization/application/tokens/authorization.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { toEmployeeResult } from '../mappers/employee-result.mapper';
import { RemoveEmployeeBranchCommand } from '../dto/remove-employee-branch.command';
import { EmployeeResult } from '../dto/employee.result';

/**
 * Phase 7.0 - removes one branch from an Employee's scope. Idempotent: a
 * branch that isn't currently assigned returns the current state as a no-op.
 * Removing the last explicit assignment restores restaurant-wide scope
 * (`Employee.hasRestaurantWideScope()`), not an error.
 */
@Injectable()
export class RemoveEmployeeFromBranchUseCase {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: RemoveEmployeeBranchCommand): Promise<EmployeeResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const employeeId = EmployeeId.create(command.employeeId);
    const branchId = BranchId.create(command.branchId);

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

    if (!employee.assignedBranchIds.includes(branchId.value)) {
      return toEmployeeResult(employee);
    }

    const now = this.clock.now();
    const updated = employee.unassignBranch(branchId.value, now);
    await this.employeeRepository.save(updated);
    await this.employeeRepository.removeBranchAssignment(employeeId, branchId);

    return toEmployeeResult(updated);
  }
}
