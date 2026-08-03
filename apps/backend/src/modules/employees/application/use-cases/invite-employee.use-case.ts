import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import { RestaurantId, RoleId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  RestaurantUsageRepository,
  RESTAURANT_USAGE_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-usage.repository';
import {
  SubscriptionRepository,
  SUBSCRIPTION_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription.repository';
import {
  SubscriptionPlanRepository,
  SUBSCRIPTION_PLAN_REPOSITORY,
} from '@modules/subscriptions/domain/repositories/subscription-plan.repository';
import { SubscriptionPolicy } from '@modules/subscriptions/domain/services/subscription-policy';
import { SubscriptionNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-not-found.exception';
import { SubscriptionPlanNotFoundException } from '@modules/subscriptions/domain/exceptions/subscription-plan-not-found.exception';
import { OrganizationLimitExceededException } from '@modules/subscriptions/domain/exceptions/organization-limit-exceeded.exception';
import { Employee } from '@modules/authorization/domain/entities/employee.entity';
import { EmployeeStatus } from '@modules/authorization/domain/enums/authorization.enums';
import { EmployeeInvitedEvent } from '@modules/authorization/domain/events/authorization.events';
import { RoleNotFoundException } from '@modules/authorization/domain/exceptions/role-not-found.exception';
import { EmployeeEmailAlreadyExistsException } from '@modules/authorization/domain/exceptions/employee-email-already-exists.exception';
import {
  EmployeeRepository,
  RoleRepository,
} from '@modules/authorization/domain/repositories/authorization.repositories';
import {
  EMPLOYEE_REPOSITORY,
  ROLE_REPOSITORY,
} from '@modules/authorization/application/tokens/authorization.tokens';
import { toEmployeeResult } from '../mappers/employee-result.mapper';
import { InviteEmployeeCommand } from '../dto/invite-employee.command';
import { EmployeeResult } from '../dto/employee.result';

/**
 * Phase 7.0 (Employee Management) - the only way an `Employee` row is
 * created. Always `status = Invited`, `userId = null` - linking to a real
 * `User` account happens exclusively at first login
 * (AUTHENTICATION_ARCHITECTURE.md §1.2), never here. Email uniqueness is
 * scoped per-restaurant, not global - `email` carries only a plain index
 * (DATABASE_SCHEMA.md), since the same person may legitimately be invited by
 * more than one restaurant.
 */
/**
 * Phase 12 (Subscriptions, ADR-027 §8/D14): `maxEmployeesPerRestaurant` is
 * per-Restaurant (D5/D16) - enforced via `RestaurantUsageRepository`'s
 * atomic conditional increment (D15) keyed to THIS restaurant's own row,
 * inside the same transaction as the Employee insert.
 */
@Injectable()
export class InviteEmployeeUseCase {
  constructor(
    @Inject(EMPLOYEE_REPOSITORY) private readonly employeeRepository: EmployeeRepository,
    @Inject(ROLE_REPOSITORY) private readonly roleRepository: RoleRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_USAGE_REPOSITORY)
    private readonly restaurantUsageRepository: RestaurantUsageRepository,
    @Inject(SUBSCRIPTION_REPOSITORY)
    private readonly subscriptionRepository: SubscriptionRepository,
    @Inject(SUBSCRIPTION_PLAN_REPOSITORY)
    private readonly subscriptionPlanRepository: SubscriptionPlanRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
  ) {}

  async execute(command: InviteEmployeeCommand): Promise<EmployeeResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);
    const roleId = RoleId.create(command.roleId);
    const email = command.email.trim().toLowerCase();

    // Tenant isolation gate - Employee carries no organizationId of its own
    // (TENANCY.md's "transitively tenant-owned" case), same relation-path
    // pattern as Branch/Table.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const role = await this.roleRepository.findById(roleId);
    if (role === null) {
      throw new RoleNotFoundException();
    }

    const existing = await this.employeeRepository.findByEmailAndRestaurantId(email, restaurantId);
    if (existing !== null) {
      throw new EmployeeEmailAlreadyExistsException(email);
    }

    const subscription = await this.subscriptionRepository.findByOrganizationId();
    if (subscription === null) {
      throw new SubscriptionNotFoundException();
    }
    SubscriptionPolicy.assertPermitsResourceCreation(subscription);
    const plan = await this.subscriptionPlanRepository.findById(subscription.subscriptionPlanId);
    if (plan === null) {
      throw new SubscriptionPlanNotFoundException();
    }

    const now = this.clock.now();
    const employee = Employee.create({
      id: this.idGenerator.generate(),
      restaurantId: restaurantId.value,
      roleId: roleId.value,
      userId: null,
      permissionsVersion: 1,
      firstName: command.firstName,
      lastName: command.lastName,
      email,
      phone: command.phone,
      status: EmployeeStatus.Invited,
      assignedBranchIds: [],
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.unitOfWork.execute(async () => {
      const withinLimit = await this.restaurantUsageRepository.incrementEmployeeCountIfUnderLimit(
        restaurantId,
        plan.maxEmployeesPerRestaurant,
      );
      if (!withinLimit) {
        throw new OrganizationLimitExceededException('maxEmployeesPerRestaurant');
      }
      await this.employeeRepository.save(employee);
    });

    await this.eventPublisher.publish(
      new EmployeeInvitedEvent(
        this.idGenerator.generate(),
        {
          employeeId: employee.employeeId.value,
          restaurantId: restaurantId.value,
          organizationId: restaurant.organizationId.value,
          roleId: roleId.value,
          email,
          invitedBy: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    return toEmployeeResult(employee);
  }
}
