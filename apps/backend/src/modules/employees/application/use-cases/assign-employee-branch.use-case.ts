import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { EmployeeId, RestaurantId, BranchId } from '@shared/domain/value-objects/identifiers.vo';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { EmployeeRepository } from '@modules/authorization/domain/repositories/authorization.repositories';
import { EMPLOYEE_REPOSITORY } from '@modules/authorization/application/tokens/authorization.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { toEmployeeResult } from '../mappers/employee-result.mapper';
import { AssignEmployeeBranchCommand } from '../dto/assign-employee-branch.command';
import { EmployeeResult } from '../dto/employee.result';

/**
 * Phase 7.0 - adds one branch to an Employee's scope. The target Branch must
 * exist and belong to the same restaurant as the Employee (cross-restaurant
 * assignment is rejected exactly like every other cross-tenant lookup in this
 * codebase - `BranchNotFoundException`, not a distinct error). Idempotent: an
 * already-assigned branch returns the current state as a no-op, matching
 * `EmployeeRepository.addBranchAssignment`'s own documented idempotency.
 */
@Injectable()
export class AssignEmployeeToBranchUseCase {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: AssignEmployeeBranchCommand): Promise<EmployeeResult> {
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

    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    if (employee.assignedBranchIds.includes(branchId.value)) {
      return toEmployeeResult(employee);
    }

    const now = this.clock.now();
    const updated = employee.assignBranch(branchId.value, now);
    await this.employeeRepository.save(updated);
    await this.employeeRepository.addBranchAssignment(employeeId, branchId, now);

    return toEmployeeResult(updated);
  }
}
