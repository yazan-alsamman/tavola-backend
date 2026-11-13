import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import {
  BranchSettingsAccessService,
  toBranchSettingsResult,
} from '../services/branch-settings-access.service';
import { UpdateBranchSettingsCommand } from '../dto/branch-settings.command';
import { BranchSettingsResult } from '../dto/branch-settings.result';

/**
 * ADR-051: full replace of one branch's reservation rules. Validation is the
 * RestaurantSettings entity's own, so a branch accepts exactly the values a
 * restaurant did.
 */
@Injectable()
export class UpdateBranchSettingsUseCase {
  constructor(
    private readonly access: BranchSettingsAccessService,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly settingsRepository: RestaurantSettingsRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: UpdateBranchSettingsCommand): Promise<BranchSettingsResult> {
    const { branchId, settings } = await this.access.load(command.restaurantId, command.branchId);
    const now = this.clock.now();
    const updated = settings.updateSettings(
      {
        reservationIntervalMinutes: command.reservationIntervalMinutes,
        maxGuestsPerReservation: command.maxGuestsPerReservation,
        cancellationWindowMinutes: command.cancellationWindowMinutes,
        pendingReservationTimeoutMinutes: command.pendingReservationTimeoutMinutes,
        defaultReservationDurationMinutes: command.defaultReservationDurationMinutes,
        autoApproval: command.autoApproval,
        timezone: settings.timezone,
        defaultCurrency: settings.defaultCurrency,
        reservationReminderMinutesBefore: command.reservationReminderMinutesBefore,
        lateArrivalGraceMinutes: command.lateArrivalGraceMinutes,
        autoApprovalMaxGuests: command.autoApprovalMaxGuests,
        minLeadTimeMinutes: command.minLeadTimeMinutes,
        maxDaysAhead: command.maxDaysAhead,
        dailyGuestCap: command.dailyGuestCap,
      },
      now,
    );
    await this.settingsRepository.saveForBranch(branchId, updated);

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'branch.settings.updated',
      targetType: 'Branch',
      targetId: branchId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return toBranchSettingsResult(branchId, updated);
  }
}
