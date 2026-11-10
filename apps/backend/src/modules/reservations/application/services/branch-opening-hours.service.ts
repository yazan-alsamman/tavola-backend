import { Injectable } from '@nestjs/common';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { ListWorkingHoursByRestaurantIdsUseCase } from '@modules/restaurants/application/use-cases/list-working-hours-by-restaurant-ids.use-case';
import { DayScheduleWindow } from '../../domain/services/reservation-time-slots.service';

interface WorkingHoursRow {
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

/**
 * A branch's weekly opening hours. A weekday uses the branch's own row when
 * it has one, otherwise the restaurant default row for that weekday, and is
 * closed when neither exists. `hasAnyHours` is false when neither the branch
 * nor the restaurant has configured a single row.
 */
export class BranchWeeklySchedule {
  constructor(
    private readonly branchRows: WorkingHoursRow[],
    private readonly restaurantRows: WorkingHoursRow[],
  ) {}

  get hasAnyHours(): boolean {
    return this.branchRows.length > 0 || this.restaurantRows.length > 0;
  }

  forDay(dayOfWeek: number): DayScheduleWindow | null {
    const row =
      this.branchRows.find((entry) => entry.dayOfWeek === dayOfWeek) ??
      this.restaurantRows.find((entry) => entry.dayOfWeek === dayOfWeek);
    return row === undefined ? null : toWindow(row);
  }
}

/**
 * The single place that resolves branch opening hours for reservations, used
 * by both the time-slot listing and reservation creation so the two can never
 * disagree on when a branch is open.
 */
@Injectable()
export class BranchOpeningHoursService {
  constructor(
    private readonly listBranchWorkingHours: ListBranchWorkingHoursByBranchIdsUseCase,
    private readonly listRestaurantWorkingHours: ListWorkingHoursByRestaurantIdsUseCase,
  ) {}

  async load(branchId: string, restaurantId: string): Promise<BranchWeeklySchedule> {
    const [branchHours, restaurantHours] = await Promise.all([
      this.listBranchWorkingHours.execute({ branchIds: [branchId] }),
      this.listRestaurantWorkingHours.execute({ restaurantIds: [restaurantId] }),
    ]);
    return new BranchWeeklySchedule(
      branchHours.get(branchId) ?? [],
      restaurantHours.get(restaurantId) ?? [],
    );
  }
}

function toWindow(entry: WorkingHoursRow): DayScheduleWindow {
  return {
    openingTime: entry.openingTime,
    closingTime: entry.closingTime,
    breakStartTime: entry.breakStartTime,
    breakEndTime: entry.breakEndTime,
  };
}
