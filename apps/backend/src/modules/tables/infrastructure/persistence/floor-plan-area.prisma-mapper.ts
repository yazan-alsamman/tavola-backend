import { FloorPlanArea as PrismaFloorPlanArea } from '@prisma/client';
import { FloorPlanArea as FloorPlanAreaEntity } from '../../domain/entities/floor-plan-area.entity';
import { FloorPlanAreaFeature } from '../../domain/enums/table.enums';

export class FloorPlanAreaPrismaMapper {
  static toDomain(row: PrismaFloorPlanArea): FloorPlanAreaEntity {
    return FloorPlanAreaEntity.reconstitute({
      id: row.id,
      floorPlanId: row.floorPlanId,
      name: row.name,
      color: row.color,
      sortOrder: row.sortOrder,
      features: row.features as FloorPlanAreaFeature[],
      layout: {
        floor: row.floor,
        positionX: row.positionX,
        positionY: row.positionY,
        width: row.width,
        height: row.height,
      },
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
    features: FloorPlanAreaFeature[];
    floor: number | null;
    positionX: number | null;
    positionY: number | null;
    width: number | null;
    height: number | null;
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
      features: props.features,
      ...props.layout,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
