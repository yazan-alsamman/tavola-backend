import { FloorPlan as PrismaFloorPlan } from '@prisma/client';
import { FloorPlan as FloorPlanEntity } from '../../domain/entities/floor-plan.entity';

export class FloorPlanPrismaMapper {
  static toDomain(row: PrismaFloorPlan): FloorPlanEntity {
    return FloorPlanEntity.reconstitute({
      id: row.id,
      branchId: row.branchId,
      name: row.name,
      isActive: row.isActive,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(floorPlan: FloorPlanEntity): {
    id: string;
    branchId: string;
    name: string;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = floorPlan.toProps();
    return {
      id: props.id,
      branchId: props.branchId,
      name: props.name,
      isActive: props.isActive,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
