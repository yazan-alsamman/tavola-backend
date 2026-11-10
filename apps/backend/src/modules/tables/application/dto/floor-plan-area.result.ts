import { FloorPlanAreaFeature } from '../../domain/enums/table.enums';
import { FloorPlanAreaLayout } from '../../domain/entities/floor-plan-area.entity';

export interface FloorPlanAreaResult {
  floorPlanAreaId: string;
  floorPlanId: string;
  name: string;
  /** Normalized uppercase `#RRGGBB` - see `HexColor`. */
  color: string;
  sortOrder: number;
  features: FloorPlanAreaFeature[];
  layout: FloorPlanAreaLayout;
  createdAt: Date;
  updatedAt: Date;
}
