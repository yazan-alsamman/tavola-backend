import { Table as PrismaTable } from '@prisma/client';
import { Table as TableEntity } from '../../domain/entities/table.entity';
import { TableShape, TableStatus } from '../../domain/enums/table.enums';

export class TablePrismaMapper {
  static toDomain(row: PrismaTable): TableEntity {
    return TableEntity.reconstitute({
      id: row.id,
      branchId: row.branchId,
      floorPlanId: row.floorPlanId,
      tableNumber: row.tableNumber,
      capacity: row.capacity,
      floor: row.floor,
      positionX: row.positionX,
      positionY: row.positionY,
      width: row.width,
      height: row.height,
      rotation: row.rotation,
      shape: row.shape as TableShape,
      layer: row.layer,
      indoor: row.indoor,
      vip: row.vip,
      smoking: row.smoking,
      status: row.status as TableStatus,
      mergeGroupId: row.mergeGroupId,
      isMergePrimary: row.isMergePrimary,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(table: TableEntity): {
    id: string;
    branchId: string;
    floorPlanId: string;
    tableNumber: string;
    capacity: number;
    floor: number | null;
    positionX: number | null;
    positionY: number | null;
    width: number | null;
    height: number | null;
    rotation: number | null;
    shape: TableShape;
    layer: number | null;
    indoor: boolean;
    vip: boolean;
    smoking: boolean;
    status: TableStatus;
    mergeGroupId: string | null;
    isMergePrimary: boolean;
    createdAt: Date;
    updatedAt: Date;
    deletedAt: Date | null;
  } {
    const props = table.toProps();
    return {
      id: props.id,
      branchId: props.branchId,
      floorPlanId: props.floorPlanId,
      tableNumber: props.tableNumber,
      capacity: props.capacity,
      floor: props.floor,
      positionX: props.positionX,
      positionY: props.positionY,
      width: props.width,
      height: props.height,
      rotation: props.rotation,
      shape: props.shape,
      layer: props.layer,
      indoor: props.indoor,
      vip: props.vip,
      smoking: props.smoking,
      status: props.status,
      mergeGroupId: props.mergeGroupId,
      isMergePrimary: props.isMergePrimary,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
