-- CR WJ-R-2026-002 round 2 (ADR-044): an area is a named rectangle on the
-- floor-plan grid with guest-facing features. All columns are additive and
-- nullable (features defaults to empty), so existing areas keep working.
CREATE TYPE "FloorPlanAreaFeature" AS ENUM ('Indoor', 'Outdoor', 'Family', 'Smoking', 'NonSmoking', 'Hookah', 'Quiet', 'Vip');

ALTER TABLE "floor_plan_areas"
  ADD COLUMN "features" "FloorPlanAreaFeature"[] NOT NULL DEFAULT ARRAY[]::"FloorPlanAreaFeature"[],
  ADD COLUMN "floor" INTEGER,
  ADD COLUMN "position_x" INTEGER,
  ADD COLUMN "position_y" INTEGER,
  ADD COLUMN "width" INTEGER,
  ADD COLUMN "height" INTEGER;
