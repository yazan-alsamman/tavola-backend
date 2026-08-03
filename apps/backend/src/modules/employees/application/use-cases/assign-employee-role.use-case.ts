import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { EmployeeId, RestaurantId, RoleId } from '@shared/domain/value-objects/identifiers.vo';
import { RoleAssignedEvent } from '@modules/authorization/domain/events/authorization.events';
import { EmployeeNotFoundException } from '@modules/authorization/domain/exceptions/employee-not-found.exception';
import { RoleNotFoundException } from '@modules/authorization/domain/exceptions/role-not-found.exception';
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
import { AssignEmployeeRoleCommand } from '../dto/assign-employee-role.command';
import { EmployeeResult } from '../dto/employee.result';

/**
 * Phase 7.0 - changes ONLY `Employee.roleId`, via `Employee.changeRole` (which
 * also bumps `permissionsVersion` in the same step - AUTHORIZATION_ARCHITECTURE.md
 * §17). Publishes the existing `RoleAssignedEvent` (built in Phase 2, never
 * previously consumed by a real use case).
 */
@Injectable()
export class AssignEmployeeRoleUseCase {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepository: RoleRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
  ) {}

  async execute(command: AssignEmployeeRoleCommand): Promise<EmployeeResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const employeeId = EmployeeId.create(command.employeeId);
    const roleId = RoleId.create(command.roleId);

    // Tenant isolation gate - Employee carries no organizationId of its own
    // (TENANCY.md's "transitively tenant-owned" case). Without this,
    // `findByIdAndRestaurantId` below would happily match a URL-supplied
    // restaurantId belonging to a DIFFERENT organization than the caller's -
    // this check is what makes that IDOR impossible, same relation-path
    // pattern as InviteEmployeeUseCase.
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

    const role = await this.roleRepository.findById(roleId);
    if (role === null) {
      throw new RoleNotFoundException();
    }

    const now = this.clock.now();
    const updated = employee.changeRole(roleId.value, now);
    await this.employeeRepository.save(updated);

    await this.eventPublisher.publish(
      new RoleAssignedEvent(
        this.idGenerator.generate(),
        {
          employeeId: employeeId.value,
          roleId: roleId.value,
          assignedBy: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toEmployeeResult(updated);
  }
}
