export interface FloorPlanAreaResult {
  floorPlanAreaId: string;
  floorPlanId: string;
  name: string;
  /** Normalized uppercase `#RRGGBB` - see `HexColor`. */
  color: string;
  sortOrder: number;
  createdAt: Date;
  updatedAt: Date;
}
