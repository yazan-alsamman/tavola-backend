import { FloorPlanArea as PrismaFloorPlanArea } from '@prisma/client';
import { FloorPlanArea as FloorPlanAreaEntity } from '../../domain/entities/floor-plan-area.entity';

export class FloorPlanAreaPrismaMapper {
  static toDomain(row: PrismaFloorPlanArea): FloorPlanAreaEntity {
    return FloorPlanAreaEntity.reconstitute({
      id: row.id,
      floorPlanId: row.floorPlanId,
      name: row.name,
      color: row.color,
      sortOrder: row.sortOrder,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(area: FloorPlanAreaEntity): {
    id: string;
    floorPlanId: string;
    name: string;
    color: string;
    sortOrder: number;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = area.toProps();
    return {
      id: props.id,
      floorPlanId: props.floorPlanId,
      name: props.name,
      color: props.color,
      sortOrder: props.sortOrder,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
