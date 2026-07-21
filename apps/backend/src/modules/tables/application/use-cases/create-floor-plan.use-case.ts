import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, ID_GENERATOR } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { FloorPlan } from '../../domain/entities/floor-plan.entity';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import { toFloorPlanResult } from '../mappers/floor-plan-result.mapper';
import { CreateFloorPlanCommand } from '../dto/create-floor-plan.command';
import { FloorPlanResult } from '../dto/floor-plan.result';

@Injectable()
export class CreateFloorPlanUseCase {
  constructor(
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: CreateFloorPlanCommand): Promise<FloorPlanResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate: FloorPlan carries no organizationId of its own
    // (TENANCY.md's "transitively tenant-owned" case) - resolving the parent
    // Restaurant then Branch through their already-tenant-scoped repositories
    // first is what makes this call safe, identical to
    // UpdateBranchWorkingHoursUseCase's own two-hop chain.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    // FloorPlan Aggregate Invariant (TASKS.md Phase 6.1 decision #5): the
    // first FloorPlan created for a Branch becomes active automatically, with
    // no manual activation step - every subsequent one starts inactive and
    // must go through ActivateFloorPlanUseCase, which atomically deactivates
    // the previously active one.
    const hasExisting = await this.floorPlanRepository.existsAnyForBranch(branchId);

    const now = this.clock.now();
    const floorPlan = FloorPlan.create({
      id: this.idGenerator.generate(),
      branchId: branchId.value,
      name: command.name,
      isActive: !hasExisting,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.floorPlanRepository.save(floorPlan);

    // EVENTS.md has no named FloorPlan domain event class (only "# Table
    // Events" is documented) - follows UpdateRestaurantSettingsUseCase's own
    // precedent exactly: direct audit-log write, no invented domain event
    // class.
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'floor_plan.created',
      targetType: 'FloorPlan',
      targetId: floorPlan.floorPlanId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toFloorPlanResult(floorPlan);
  }
}
