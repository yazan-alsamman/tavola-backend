import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK } from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '../../domain/repositories/restaurant.repository';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '../../domain/repositories/restaurant-settings.repository';
import { RestaurantNotFoundException } from '../../domain/exceptions/restaurant-not-found.exception';
import { toRestaurantSettingsResult } from '../mappers/restaurant-settings-result.mapper';
import { UpdateRestaurantSettingsCommand } from '../dto/update-restaurant-settings.command';
import { RestaurantSettingsResult } from '../dto/restaurant-settings.result';

@Injectable()
export class UpdateRestaurantSettingsUseCase {
  constructor(
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateRestaurantSettingsCommand): Promise<RestaurantSettingsResult> {
    const restaurantId = RestaurantId.create(command.restaurantId);

    // Tenant isolation gate - see GetRestaurantSettingsUseCase's own comment.
    const restaurant = await this.restaurantRepository.findById(restaurantId);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(restaurantId);
    if (settings === null) {
      throw new RestaurantNotFoundException();
    }

    const now = this.clock.now();
    const updated = settings.updateSettings(
      {
        reservationIntervalMinutes: command.reservationIntervalMinutes,
        maxGuestsPerReservation: command.maxGuestsPerReservation,
        cancellationWindowMinutes: command.cancellationWindowMinutes,
        pendingReservationTimeoutMinutes: command.pendingReservationTimeoutMinutes,
        autoApproval: command.autoApproval,
        timezone: command.timezone,
        defaultCurrency: command.defaultCurrency,
      },
      now,
    );

    await this.restaurantSettingsRepository.save(updated);

    // EVENTS.md lists "Restaurant settings updated" only as an Audit Events
    // example, not as a named class under "# Restaurant Events" - so this
    // follows UpdateUserProfileUseCase's own precedent (direct audit write,
    // no invented domain event class) rather than UpdateRestaurantUseCase's
    // event-publishing path (which maps documented, concretely-named events).
    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'restaurant.settings.updated',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toRestaurantSettingsResult(updated);
  }
}
