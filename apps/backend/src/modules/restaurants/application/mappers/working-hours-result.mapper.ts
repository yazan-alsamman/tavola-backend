import { WorkingHours } from '../../domain/entities/working-hours.entity';
import { WorkingHoursResult } from '../dto/working-hours.result';

export function toWorkingHoursResult(
  restaurantId: string,
  entries: WorkingHours[],
): WorkingHoursResult {
  return {
    restaurantId,
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
