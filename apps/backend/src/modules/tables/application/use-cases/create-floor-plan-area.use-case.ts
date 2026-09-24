import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { FloorPlanArea } from '../../domain/entities/floor-plan-area.entity';
import {
  FloorPlanRepository,
  FLOOR_PLAN_REPOSITORY,
} from '../../domain/repositories/floor-plan.repository';
import {
  FloorPlanAreaRepository,
  FLOOR_PLAN_AREA_REPOSITORY,
} from '../../domain/repositories/floor-plan-area.repository';
import { FloorPlanAreaNameAlreadyExistsException } from '../../domain/exceptions/floor-plan-area-name-already-exists.exception';
import { resolveFloorPlanScope } from '../services/resolve-floor-plan-scope';
import { toFloorPlanAreaResult } from '../mappers/floor-plan-area-result.mapper';
import { CreateFloorPlanAreaCommand } from '../dto/create-floor-plan-area.command';
import { FloorPlanAreaResult } from '../dto/floor-plan-area.result';

/**
 * ADR-040 - creates one concurrent dining area (hall) inside an existing
 * FloorPlan. Deliberately has NO activation concept: every Area of a FloorPlan
 * is live simultaneously, which is the entire reason this entity exists rather
 * than more `FloorPlan` rows (`FloorPlan.isActive`'s "at most one active layout
 * per branch" invariant is untouched by this whole feature).
 *
 * Audit-log write, no domain event (decision #9): this follows
 * `CreateFloorPlanUseCase`'s own precedent exactly - `EVENTS.md` defines no
 * FloorPlan event class, there is no floor-plan room in the Phase 8 realtime
 * allow-list, and no consumer exists. Publishing an unconsumed event class
 * would add an allow-list decision for nobody's benefit.
 */
@Injectable()
export class CreateFloorPlanAreaUseCase {
  constructor(
    @Inject(FLOOR_PLAN_AREA_REPOSITORY)
    private readonly floorPlanAreaRepository: FloorPlanAreaRepository,
    @Inject(FLOOR_PLAN_REPOSITORY) private readonly floorPlanRepository: FloorPlanRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: CreateFloorPlanAreaCommand): Promise<FloorPlanAreaResult> {
    const { floorPlan } = await resolveFloorPlanScope(
      {
        restaurantRepository: this.restaurantRepository,
        branchRepository: this.branchRepository,
        floorPlanRepository: this.floorPlanRepository,
      },
      command,
    );

    // Checked against the trimmed name the entity will actually store, so
    // "Main Hall" and "Main Hall " cannot both be created. The partial unique
    // index is the race-condition backstop; this check exists to return the
    // documented 409 instead of a raw constraint violation.
    const name = command.name.trim();
    if (
      await this.floorPlanAreaRepository.existsByFloorPlanIdAndName(floorPlan.floorPlanId, name)
    ) {
      throw new FloorPlanAreaNameAlreadyExistsException(name);
    }

    const now = this.clock.now();
    const area = FloorPlanArea.create({
      id: this.idGenerator.generate(),
      floorPlanId: floorPlan.floorPlanId.value,
      name: command.name,
      color: command.color,
      sortOrder: command.sortOrder,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    });

    await this.floorPlanAreaRepository.save(area);

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'floor_plan_area.created',
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
