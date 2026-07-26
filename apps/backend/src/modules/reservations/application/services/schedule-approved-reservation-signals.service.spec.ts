import { ScheduleApprovedReservationSignalsService } from './schedule-approved-reservation-signals.service';
import { Reservation } from '../../domain/entities/reservation.entity';
import { ReservationSource } from '../../domain/enums/reservation.enums';
import { RestaurantSettings } from '@modules/restaurants/domain/entities/restaurant-settings.entity';
import { InMemoryRestaurantSettingsRepository } from '../../../../../test/restaurants/support/in-memory-restaurant-settings.repository';
import { InMemoryApprovedReservationOperationalScheduler } from '../../../../../test/reservations/support/in-memory-approved-reservation-operational-scheduler';

describe('ScheduleApprovedReservationSignalsService', () => {
  const now = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '44444444-4444-4444-8444-444444444444';
  const tableId = '55555555-5555-4555-8555-555555555555';
  const reservationId = '66666666-6666-4666-8666-666666666666';

  function approvedReservation() {
    return Reservation.createAutoApproved({
      id: reservationId,
      userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      reservationGuestId: null,
      source: ReservationSource.Online,
      restaurantId,
      branchId,
      tableId,
      reservationDate: new Date('2026-08-01T00:00:00.000Z'),
      reservationStartTime: new Date('2026-08-01T18:00:00.000Z'),
      reservationEndTime: new Date('2026-08-01T19:30:00.000Z'),
      guests: 2,
      tableCapacity: 4,
      notes: null,
      createdBy: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      now,
    });
  }

  function build() {
    const restaurantSettingsRepository = new InMemoryRestaurantSettingsRepository();
    const scheduler = new InMemoryApprovedReservationOperationalScheduler();
    const service = new ScheduleApprovedReservationSignalsService(
      scheduler,
      restaurantSettingsRepository,
    );
    return { service, restaurantSettingsRepository, scheduler };
  }

  it('resolves reminderMinutesBefore/lateArrivalGraceMinutes from the restaurant own RestaurantSettings', async () => {
    const { service, restaurantSettingsRepository, scheduler } = build();
    await restaurantSettingsRepository.save(
      RestaurantSettings.createDefault('settings-1', restaurantId, now).updateSettings(
        {
          reservationIntervalMinutes: 30,
          maxGuestsPerReservation: 20,
          cancellationWindowMinutes: 60,
          pendingReservationTimeoutMinutes: 15,
          defaultReservationDurationMinutes: 90,
          autoApproval: false,
          timezone: 'UTC',
          defaultCurrency: null,
          reservationReminderMinutesBefore: 45,
          lateArrivalGraceMinutes: 20,
        },
        now,
      ),
    );

    await service.scheduleForApproved(approvedReservation());

    const scheduled = scheduler.scheduled.get(reservationId);
    expect(scheduled?.reminderMinutesBefore).toBe(45);
    expect(scheduled?.lateArrivalGraceMinutes).toBe(20);
  });

  it('falls back to 60/15 when no RestaurantSettings row exists for the restaurant', async () => {
    const { service, scheduler } = build();

    await service.scheduleForApproved(approvedReservation());

    const scheduled = scheduler.scheduled.get(reservationId);
    expect(scheduled?.reminderMinutesBefore).toBe(60);
    expect(scheduled?.lateArrivalGraceMinutes).toBe(15);
  });

  it('replaceForApproved delegates to the port own replace method, not scheduleForApproved', async () => {
    const { service, scheduler } = build();

    await service.replaceForApproved(approvedReservation());

    expect(scheduler.replaceCallCount).toBe(1);
    expect(scheduler.scheduleCallCount).toBe(0);
  });

  it('cancelForReservation delegates to the port directly, with no RestaurantSettings lookup', async () => {
    const { service, scheduler } = build();

    await service.cancelForReservation(reservationId);

    expect(scheduler.cancelledReservationIds).toContain(reservationId);
  });
});
