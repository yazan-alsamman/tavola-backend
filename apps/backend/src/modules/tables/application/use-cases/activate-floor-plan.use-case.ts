import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { BranchId, FloorPlanId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
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
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import { FloorPlanNotFoundException } from '../../domain/exceptions/floor-plan-not-found.exception';
import { toFloorPlanResult } from '../mappers/floor-plan-result.mapper';
import { ActivateFloorPlanCommand } from '../dto/activate-floor-plan.command';
import { FloorPlanResult } from '../dto/floor-plan.result';

@Injectable()
export class ActivateFloorPlanUseCase {
  constructor(
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: ActivateFloorPlanCommand): Promise<FloorPlanResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see CreateFloorPlanUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const floorPlanId = FloorPlanId.create(command.floorPlanId);
    const existing = await this.floorPlanRepository.findByIdAndBranchId(floorPlanId, branchId);
    if (existing === null) {
      throw new FloorPlanNotFoundException();
    }

    const now = this.clock.now();
    // Aggregate Invariant (TASKS.md Phase 6.1 decision #5): atomically
    // deactivates every other FloorPlan of this branch inside one
    // transaction - at most one active FloorPlan per branch at all times.
    const activated = await this.floorPlanRepository.activate(floorPlanId, branchId, now);

    // EVENTS.md has no named FloorPlan domain event class - direct audit
    // write, no invented domain event class (see CreateFloorPlanUseCase).
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'floor_plan.activated',
      targetType: 'FloorPlan',
      targetId: activated.floorPlanId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toFloorPlanResult(activated);
  }
}
