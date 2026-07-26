import { Injectable, Inject } from '@nestjs/common';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import { Reservation } from '../../domain/entities/reservation.entity';
import {
  ApprovedReservationOperationalSchedulerPort,
  APPROVED_RESERVATION_OPERATIONAL_SCHEDULER,
} from '../ports/approved-reservation-operational-scheduler.port';

/**
 * Phase 7.6 (Operational Signals, ADR-019) - the single call site every
 * Approved-reservation-affecting use case goes through, so the
 * `RestaurantSettings.reservationReminderMinutesBefore`/
 * `lateArrivalGraceMinutes` lookup-with-fallback (mirroring every other
 * settings-driven default in this module, e.g.
 * `ApproveReservationUseCase`'s own `reservationIntervalMinutes ?? 30`) is
 * written once, not duplicated across Approve/Create/WaitlistPromotion/
 * Reschedule/Cancel/Complete/NoShow (CLAUDE.md: "never duplicate code").
 * Thin wrapper around `ApprovedReservationOperationalSchedulerPort` -
 * carries no state and performs no persistence of its own.
 */
@Injectable()
export class ScheduleApprovedReservationSignalsService {
  constructor(
    @Inject(APPROVED_RESERVATION_OPERATIONAL_SCHEDULER)
    private readonly scheduler: ApprovedReservationOperationalSchedulerPort,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
  ) {}

  /**
   * Called after commit whenever a reservation newly becomes `Approved`
   * (manual Approve, auto-approval on Create, auto-approval on Waitlist
   * promotion) - schedules both the Reminder and Late-Arrival jobs for the
   * first time.
   */
  async scheduleForApproved(reservation: Reservation, correlationId?: string): Promise<void> {
    const { reminderMinutesBefore, lateArrivalGraceMinutes } =
      await this.resolveMinutes(reservation);
    await this.scheduler.scheduleForApproved(
      reservation.reservationId.value,
      reservation.restaurantId.value,
      reservation.branchId.value,
      reservation.reservationStartTime,
      reminderMinutesBefore,
      lateArrivalGraceMinutes,
      correlationId,
    );
  }

  /**
   * Called after commit whenever an already-`Approved` reservation's
   * `reservationStartTime` changes (Reschedule landing back on `Approved`) -
   * removes both stale jobs and re-adds them against the new window.
   */
  async replaceForApproved(reservation: Reservation, correlationId?: string): Promise<void> {
    const { reminderMinutesBefore, lateArrivalGraceMinutes } =
      await this.resolveMinutes(reservation);
    await this.scheduler.replaceForApproved(
      reservation.reservationId.value,
      reservation.restaurantId.value,
      reservation.branchId.value,
      reservation.reservationStartTime,
      reminderMinutesBefore,
      lateArrivalGraceMinutes,
      correlationId,
    );
  }

  /**
   * Called after commit whenever an `Approved` reservation leaves `Approved`
   * before either signal fires (Cancel/Complete/NoShow).
   */
  async cancelForReservation(reservationId: string): Promise<void> {
    await this.scheduler.cancelForReservation(reservationId);
  }

  private async resolveMinutes(
    reservation: Reservation,
  ): Promise<{ reminderMinutesBefore: number; lateArrivalGraceMinutes: number }> {
    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      reservation.restaurantId,
    );
    return {
      reminderMinutesBefore: settings?.reservationReminderMinutesBefore ?? 60,
      lateArrivalGraceMinutes: settings?.lateArrivalGraceMinutes ?? 15,
    };
  }
}
