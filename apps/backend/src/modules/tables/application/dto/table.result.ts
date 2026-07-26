import { TableShape, TableStatus } from '../../domain/enums/table.enums';

export interface TableResult {
  tableId: string;
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
}
