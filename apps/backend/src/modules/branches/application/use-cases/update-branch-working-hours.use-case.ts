import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantNotFoundException } from '@modules/restaurants/domain/exceptions/restaurant-not-found.exception';
import { BranchRepository, BRANCH_REPOSITORY } from '../../domain/repositories/branch.repository';
import { BranchNotFoundException } from '../../domain/exceptions/branch-not-found.exception';
import {
  BranchWorkingHoursRepository,
  BRANCH_WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/branch-working-hours.repository';
import { InvalidBranchWorkingHoursException } from '../../domain/exceptions/invalid-branch-working-hours.exception';
import { BranchWorkingHours } from '../../domain/entities/branch-working-hours.entity';
import { toBranchWorkingHoursResult } from '../mappers/branch-working-hours-result.mapper';
import { UpdateBranchWorkingHoursCommand } from '../dto/update-branch-working-hours.command';
import { BranchWorkingHoursResult } from '../dto/branch-working-hours.result';

@Injectable()
export class UpdateBranchWorkingHoursUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(BRANCH_WORKING_HOURS_REPOSITORY)
    private readonly branchWorkingHoursRepository: BranchWorkingHoursRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateBranchWorkingHoursCommand): Promise<BranchWorkingHoursResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see GetBranchWorkingHoursUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const branchId = BranchId.create(command.branchId);
    const branch = await this.branchRepository.findByIdAndRestaurantId(branchId, restaurantId);
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const seenDays = new Set<number>();
    for (const entry of command.entries) {
      if (seenDays.has(entry.dayOfWeek)) {
        throw new InvalidBranchWorkingHoursException(
          `Duplicate dayOfWeek ${entry.dayOfWeek} in request - each day may appear at most once.`,
        );
      }
      seenDays.add(entry.dayOfWeek);
    }

    const now = this.clock.now();
    // Full-replace semantics, matching UpdateWorkingHoursUseCase's own
    // established convention.
    const entries = command.entries.map((entry) =>
      BranchWorkingHours.create({
        id: this.idGenerator.generate(),
        branchId: branchId.value,
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime,
        breakEndTime: entry.breakEndTime,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.branchWorkingHoursRepository.replaceAllForBranch(branchId, entries);

    // EVENTS.md has no named "BranchWorkingHours" domain event class - follows
    // UpdateWorkingHoursUseCase's own precedent exactly: direct audit write,
    // no invented domain event class.
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'branch.working_hours.updated',
      targetType: 'Branch',
      targetId: branchId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toBranchWorkingHoursResult(branchId.value, entries);
  }
}
