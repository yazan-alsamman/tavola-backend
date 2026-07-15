import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, ID_GENERATOR } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  WorkingHoursRepository,
  WORKING_HOURS_REPOSITORY,
} from '../../domain/repositories/working-hours.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { InvalidWorkingHoursException } from '../../domain/exceptions/invalid-working-hours.exception';
import { WorkingHours } from '../../domain/entities/working-hours.entity';
import { toWorkingHoursResult } from '../mappers/working-hours-result.mapper';
import { UpdateWorkingHoursCommand } from '../dto/update-working-hours.command';
import { WorkingHoursResult } from '../dto/working-hours.result';

@Injectable()
export class UpdateWorkingHoursUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(WORKING_HOURS_REPOSITORY)
    private readonly workingHoursRepository: WorkingHoursRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateWorkingHoursCommand): Promise<WorkingHoursResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see GetWorkingHoursUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const seenDays = new Set<number>();
    for (const entry of command.entries) {
      if (seenDays.has(entry.dayOfWeek)) {
        throw new InvalidWorkingHoursException(
          `Duplicate dayOfWeek ${entry.dayOfWeek} in request - each day may appear at most once.`,
        );
      }
      seenDays.add(entry.dayOfWeek);
    }

    const now = this.clock.now();
    // Full-replace semantics (matching every other update use case in this
    // module): the submitted entries become the entire week, so unchanged
    // days are re-created with new ids rather than diffed against the
    // existing rows - the simplest implementation consistent with a
    // collection-shaped, full-replace child entity, per this phase's
    // explicit "keep the implementation intentionally minimal" instruction.
    const workingHours = command.entries.map((entry) =>
      WorkingHours.create({
        id: this.idGenerator.generate(),
        restaurantId: restaurantId.value,
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime,
        breakEndTime: entry.breakEndTime,
        createdAt: now,
        updatedAt: now,
      }),
    );

    await this.workingHoursRepository.replaceAllForRestaurant(restaurantId, workingHours);

    // EVENTS.md has no named "WorkingHours" domain event class - follows
    // UpdateRestaurantSettingsUseCase's own precedent (direct audit write,
    // no invented domain event class).
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.working_hours.updated',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toWorkingHoursResult(restaurantId.value, workingHours);
  }
}
