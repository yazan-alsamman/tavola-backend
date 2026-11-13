import { Inject, Injectable } from '@nestjs/common';
import {
  BranchClosureRepository,
  BRANCH_CLOSURE_REPOSITORY,
} from '@modules/branches/domain/repositories/branch-closure.repository';
import { ListBranchWorkingHoursByBranchIdsUseCase } from '@modules/branches/application/use-cases/list-branch-working-hours-by-branch-ids.use-case';
import { DayScheduleWindow } from '../../domain/services/reservation-time-slots.service';

interface WorkingHoursRow {
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

/**
 * A branch's weekly opening hours. Hours belong to the branch alone
 * (ADR-050): a weekday without a branch row is closed, and `hasAnyHours` is
 * false while the branch has not configured a single row.
 */
export class BranchWeeklySchedule {
  constructor(private readonly rows: WorkingHoursRow[]) {}

  get hasAnyHours(): boolean {
    return this.rows.length > 0;
  }

  forDay(dayOfWeek: number): DayScheduleWindow | null {
    const row = this.rows.find((entry) => entry.dayOfWeek === dayOfWeek);
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
    @Inject(BRANCH_CLOSURE_REPOSITORY) private readonly closures: BranchClosureRepository,
  ) {}

  /** ADR-053: true when a temporary closure covers this branch-local date. */
  isClosedOn(branchId: string, date: string): Promise<boolean> {
    return this.closures.isClosedOn(branchId, date);
  }

  async load(branchId: string): Promise<BranchWeeklySchedule> {
    const branchHours = await this.listBranchWorkingHours.execute({ branchIds: [branchId] });
    return new BranchWeeklySchedule(branchHours.get(branchId) ?? []);
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
