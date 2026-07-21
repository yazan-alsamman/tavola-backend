import { BranchWorkingHours } from '../../domain/entities/branch-working-hours.entity';
import { BranchWorkingHoursResult } from '../dto/branch-working-hours.result';

export function toBranchWorkingHoursResult(
  branchId: string,
  entries: BranchWorkingHours[],
): BranchWorkingHoursResult {
  return {
    branchId,
    entries: [...entries]
      .sort((a, b) => a.dayOfWeek - b.dayOfWeek)
      .map((entry) => ({
        dayOfWeek: entry.dayOfWeek,
        openingTime: entry.openingTime,
        closingTime: entry.closingTime,
        breakStartTime: entry.breakStartTime,
        breakEndTime: entry.breakEndTime,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
      })),
  };
}
