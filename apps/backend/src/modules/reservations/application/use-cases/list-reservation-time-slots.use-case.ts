import { Injectable, Inject } from '@nestjs/common';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { CLOCK, ClockPort } from '@shared/application/ports/clock.port';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { ListWorkingHoursByRestaurantIdsUseCase } from '@modules/restaurants/application/use-cases/list-working-hours-by-restaurant-ids.use-case';
import {
  RestaurantSettingsRepository,
  RESTAURANT_SETTINGS_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant-settings.repository';
import {
  TableRepository,
  TABLE_REPOSITORY,
} from '@modules/tables/domain/repositories/table.repository';
import { InvalidReservationTimeException } from '../../domain/exceptions/invalid-reservation-time.exception';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '../../domain/repositories/reservation.repository';
import {
  buildReservationTimeSlots,
  calendarDateInTimeZone,
  dayOfWeekFromCalendarDate,
  DayScheduleWindow,
  parseCalendarDate,
  zonedLocalToUtcIso,
} from '../../domain/services/reservation-time-slots.service';
import {
  ReservationSlotOutcome,
  ReservationTimeSlotResult,
  ReservationTimeSlotsResult,
} from '../dto/reservation-time-slots.result';

const DEFAULT_INTERVAL_MINUTES = 30;
const DEFAULT_DURATION_MINUTES = 90;
const DEFAULT_MAX_GUESTS = 20;
const MIN_DURATION_MINUTES = 15;
const MAX_DURATION_MINUTES = 480;

export interface ListReservationTimeSlotsCommand {
  branchId: string;
  date: string;
  partySize: number;
  durationMinutes?: number;
}

interface InstantWindow {
  start: Date;
  end: Date;
}

/**
 * Bookable reservation windows for one branch and calendar date.
 *
 * Candidates step from the open window by the restaurant reservation
 * interval and each window is the applied duration. A branch weekday row
 * wins over the restaurant default; a missing row on both means closed.
 * A window is returned only when at least one Available table can seat the
 * party and has no Pending or Approved overlap. Informational, same as
 * Search Availability: creating the reservation remains the conflict check.
 */
@Injectable()
export class ListReservationTimeSlotsUseCase {
  constructor(
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    private readonly listBranchWorkingHours: ListBranchWorkingHoursByBranchIdsUseCase,
    private readonly listRestaurantWorkingHours: ListWorkingHoursByRestaurantIdsUseCase,
    @Inject(RESTAURANT_SETTINGS_REPOSITORY)
    private readonly restaurantSettingsRepository: RestaurantSettingsRepository,
    @Inject(TABLE_REPOSITORY) private readonly tableRepository: TableRepository,
    @Inject(RESERVATION_REPOSITORY)
    private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
  ) {}

  async execute(command: ListReservationTimeSlotsCommand): Promise<ReservationTimeSlotsResult> {
    if (parseCalendarDate(command.date) === null) {
      throw new InvalidReservationTimeException('"date" must be a calendar date (YYYY-MM-DD).');
    }
    if (!Number.isInteger(command.partySize) || command.partySize < 1) {
      throw new InvalidReservationTimeException('partySize must be an integer of at least 1.');
    }

    const branch = await this.branchRepository.findById(BranchId.create(command.branchId));
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    const settings = await this.restaurantSettingsRepository.findByRestaurantId(
      RestaurantId.create(branch.restaurantId.value),
    );
    const intervalMinutes = settings?.reservationIntervalMinutes ?? DEFAULT_INTERVAL_MINUTES;
    const durationMinutes = this.resolveDuration(
      command.durationMinutes,
      settings?.defaultReservationDurationMinutes ?? DEFAULT_DURATION_MINUTES,
    );
    const maxGuests = settings?.maxGuestsPerReservation ?? DEFAULT_MAX_GUESTS;
    if (command.partySize > maxGuests) {
      throw new InvalidReservationTimeException(
        `partySize must not exceed the restaurant maximum of ${maxGuests}.`,
      );
    }

    const today = calendarDateInTimeZone(this.clock.now(), branch.timezone);
    if (command.date < today) {
      throw new InvalidReservationTimeException('"date" must not be in the past.');
    }

    const dayOfWeek = dayOfWeekFromCalendarDate(command.date);
    const schedule = await this.resolveSchedule(
      command.branchId,
      branch.restaurantId.value,
      dayOfWeek,
    );
    const base = {
      branchId: command.branchId,
      date: command.date,
      timezone: branch.timezone,
      dayOfWeek,
      openingTime: schedule?.openingTime ?? null,
      closingTime: schedule?.closingTime ?? null,
      intervalMinutes,
      durationMinutes,
    };

    const candidates = buildReservationTimeSlots(
      command.date,
      schedule,
      intervalMinutes,
      durationMinutes,
    ).map((slot) => ({
      start: new Date(zonedLocalToUtcIso(slot.date, slot.startTime, branch.timezone)),
      end: new Date(zonedLocalToUtcIso(slot.endDate, slot.endTime, branch.timezone)),
    }));

    if (candidates.length === 0) {
      return { ...base, outcome: ReservationSlotOutcome.Closed, slots: [] };
    }

    const now = this.clock.now().getTime();
    const upcoming = candidates.filter((slot) => slot.start.getTime() > now);
    if (upcoming.length === 0) {
      return { ...base, outcome: ReservationSlotOutcome.NoRemainingSlots, slots: [] };
    }

    const tables = await this.tableRepository.findManyAvailableByBranchIdAndMinCapacity(
      BranchId.create(command.branchId),
      command.partySize,
    );
    if (tables.length === 0) {
      return { ...base, outcome: ReservationSlotOutcome.NoSuitableTable, slots: [] };
    }

    const windowStart = upcoming[0].start;
    const windowEnd = upcoming.reduce(
      (latest, slot) => (slot.end.getTime() > latest.getTime() ? slot.end : latest),
      upcoming[0].end,
    );
    const overlapping = await this.reservationRepository.findOverlappingPendingOrApprovedForTables(
      tables.map((table) => table.tableId),
      windowStart,
      windowEnd,
    );

    const slots = upcoming
      .filter((slot) =>
        tables.some(
          (table) =>
            !overlapping.some(
              (reservation) =>
                reservation.tableId.value === table.tableId.value &&
                reservation.reservationStartTime.getTime() < slot.end.getTime() &&
                reservation.reservationEndTime.getTime() > slot.start.getTime(),
            ),
        ),
      )
      .map(toSlot);

    return {
      ...base,
      outcome:
        slots.length === 0
          ? ReservationSlotOutcome.NoSuitableTable
          : ReservationSlotOutcome.Available,
      slots,
    };
  }

  private resolveDuration(requested: number | undefined, fallback: number): number {
    const duration = requested ?? fallback;
    if (
      !Number.isInteger(duration) ||
      duration < MIN_DURATION_MINUTES ||
      duration > MAX_DURATION_MINUTES
    ) {
      throw new InvalidReservationTimeException(
        'durationMinutes must be an integer between 15 and 480.',
      );
    }
    return duration;
  }

  private async resolveSchedule(
    branchId: string,
    restaurantId: string,
    dayOfWeek: number,
  ): Promise<DayScheduleWindow | null> {
    const branchHours = await this.listBranchWorkingHours.execute({ branchIds: [branchId] });
    const branchDay = (branchHours.get(branchId) ?? []).find(
      (entry) => entry.dayOfWeek === dayOfWeek,
    );
    if (branchDay !== undefined) {
      return toWindow(branchDay);
    }

    const restaurantHours = await this.listRestaurantWorkingHours.execute({
      restaurantIds: [restaurantId],
    });
    const restaurantDay = (restaurantHours.get(restaurantId) ?? []).find(
      (entry) => entry.dayOfWeek === dayOfWeek,
    );
    return restaurantDay === undefined ? null : toWindow(restaurantDay);
  }
}

function toWindow(entry: {
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}): DayScheduleWindow {
  return {
    openingTime: entry.openingTime,
    closingTime: entry.closingTime,
    breakStartTime: entry.breakStartTime,
    breakEndTime: entry.breakEndTime,
  };
}

function toSlot(window: InstantWindow): ReservationTimeSlotResult {
  return { startTime: window.start.toISOString(), endTime: window.end.toISOString() };
}
