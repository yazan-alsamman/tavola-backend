import { BranchWorkingHours as PrismaBranchWorkingHours } from '@prisma/client';
import { BranchWorkingHours as BranchWorkingHoursEntity } from '../../domain/entities/branch-working-hours.entity';

export class BranchWorkingHoursPrismaMapper {
  static toDomain(row: PrismaBranchWorkingHours): BranchWorkingHoursEntity {
    return BranchWorkingHoursEntity.reconstitute({
      id: row.id,
      branchId: row.branchId,
      dayOfWeek: row.dayOfWeek,
      openingTime: row.openingTime,
      closingTime: row.closingTime,
      breakStartTime: row.breakStartTime,
      breakEndTime: row.breakEndTime,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    });
  }

  static toPersistence(entry: BranchWorkingHoursEntity): PrismaBranchWorkingHours {
    const props = entry.toProps();
    return {
      id: props.id,
      branchId: props.branchId,
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
