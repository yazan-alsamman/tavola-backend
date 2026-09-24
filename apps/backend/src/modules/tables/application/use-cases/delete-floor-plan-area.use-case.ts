import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { FloorPlanAreaId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import {
  FloorPlanAreaRepository,
  FLOOR_PLAN_AREA_REPOSITORY,
} from '../../domain/repositories/floor-plan-area.repository';
import { FloorPlanAreaNotFoundException } from '../../domain/exceptions/floor-plan-area-not-found.exception';
import { FloorPlanAreaInUseException } from '../../domain/exceptions/floor-plan-area-in-use.exception';
import { resolveFloorPlanScope } from '../services/resolve-floor-plan-scope';
import { DeleteFloorPlanAreaCommand } from '../dto/delete-floor-plan-area.command';

/**
 * ADR-040 decision #7. Soft delete (API_GUIDELINES.md), guarded exactly like
 * the documented FloorPlan guard it mirrors: an Area still referenced by any
 * non-soft-deleted Table cannot be deleted, and the request is rejected rather
 * than silently reassigning or orphaning those tables. The caller decides what
 * should happen to them - moving them to another area or deleting them are
 * different intents, and the server has no basis to pick one.
 *
 * Soft-deleting the area releases its name for reuse (the partial unique index
 * is `WHERE deleted_at IS NULL`), which is why the name check in Create/Update
 * consults live rows only.
 */
@Injectable()
export class DeleteFloorPlanAreaUseCase {
  constructor(
    @Inject(FLOOR_PLAN_AREA_REPOSITORY)
    private readonly floorPlanAreaRepository: FloorPlanAreaRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: DeleteFloorPlanAreaCommand): Promise<void> {
    const { floorPlan } = await resolveFloorPlanScope(
      {
        restaurantRepository: this.restaurantRepository,
        branchRepository: this.branchRepository,
        floorPlanRepository: this.floorPlanRepository,
      },
      command,
    );

    const areaId = FloorPlanAreaId.create(command.floorPlanAreaId);
    const existing = await this.floorPlanAreaRepository.findByIdAndFloorPlanId(
      areaId,
      floorPlan.floorPlanId,
    );
    if (existing === null) {
      throw new FloorPlanAreaNotFoundException();
    }

    const assignedTables = await this.floorPlanAreaRepository.countAssignedTables(areaId);
    if (assignedTables > 0) {
      throw new FloorPlanAreaInUseException(assignedTables);
    }

    const now = this.clock.now();
    await this.floorPlanAreaRepository.save(existing.softDelete(now));

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'floor_plan_area.deleted',
      targetType: 'FloorPlanArea',
      targetId: areaId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });
  }
}
