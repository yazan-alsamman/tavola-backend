import { WorkingHours as PrismaWorkingHours } from '@prisma/client';
import { WorkingHours as WorkingHoursEntity } from '../../domain/entities/working-hours.entity';

export class WorkingHoursPrismaMapper {
  static toDomain(row: PrismaWorkingHours): WorkingHoursEntity {
    return WorkingHoursEntity.reconstitute({
      id: row.id,
      restaurantId: row.restaurantId,
      dayOfWeek: row.dayOfWeek,
      openingTime: row.openingTime,
      closingTime: row.closingTime,
      breakStartTime: row.breakStartTime,
      breakEndTime: row.breakEndTime,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(workingHours: WorkingHoursEntity): PrismaWorkingHours {
    const props = workingHours.toProps();
    return {
      id: props.id,
      restaurantId: props.restaurantId,
      dayOfWeek: props.dayOfWeek,
      openingTime: props.openingTime,
      closingTime: props.closingTime,
      breakStartTime: props.breakStartTime,
      breakEndTime: props.breakEndTime,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
    };
  }
}
