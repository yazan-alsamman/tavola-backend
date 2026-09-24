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
import { FloorPlanAreaNameAlreadyExistsException } from '../../domain/exceptions/floor-plan-area-name-already-exists.exception';
import { resolveFloorPlanScope } from '../services/resolve-floor-plan-scope';
import { toFloorPlanAreaResult } from '../mappers/floor-plan-area-result.mapper';
import { UpdateFloorPlanAreaCommand } from '../dto/update-floor-plan-area.command';
import { FloorPlanAreaResult } from '../dto/floor-plan-area.result';

/**
 * ADR-040. Full-replace of the Area's own attributes (name, color, tab order),
 * matching `UpdateTableUseCase`'s convention. Never reassigns `floorPlanId`:
 * every table placed in the area is positioned relative to one specific
 * FloorPlan, so migrating the area would silently invalidate all of them.
 */
@Injectable()
export class UpdateFloorPlanAreaUseCase {
  constructor(
    @Inject(FLOOR_PLAN_AREA_REPOSITORY)
    private readonly floorPlanAreaRepository: FloorPlanAreaRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateFloorPlanAreaCommand): Promise<FloorPlanAreaResult> {
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

    const name = command.name.trim();
    if (name !== existing.name) {
      const conflict = await this.floorPlanAreaRepository.existsByFloorPlanIdAndName(
        floorPlan.floorPlanId,
        name,
        areaId,
      );
      if (conflict) {
        throw new FloorPlanAreaNameAlreadyExistsException(name);
      }
    }

    const now = this.clock.now();
    const area = existing.updateProfile(
      { name: command.name, color: command.color, sortOrder: command.sortOrder },
      now,
    );

    await this.floorPlanAreaRepository.save(area);

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'floor_plan_area.updated',
      targetType: 'FloorPlanArea',
      targetId: area.floorPlanAreaId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toFloorPlanAreaResult(area);
  }
}
