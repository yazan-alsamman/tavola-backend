-- ADR-040 - Concurrent dining areas (halls) inside one FloorPlan.
--
-- Forward:   creates `floor_plan_areas`; adds the nullable `floor_plan_area_id`
--            and `color` columns to `tables`, plus the composite foreign key
--            that binds a table's area to the table's own floor plan.
-- Rollback:  Tier 1 (additive only) - drop the two `tables` columns (which
--            drops the composite FK and its index with them), then drop
--            `floor_plan_areas` in reverse order.
-- Data:      purely additive. No backfill, no INSERT/UPDATE of business data
--            (MIGRATION_POLICY.md forbids it in a migration): every existing
--            table row keeps `floor_plan_area_id = NULL`, the documented
--            "placed on the layout itself, in no named area" state.
-- Downtime:  none. `ADD COLUMN` of a nullable column with no default takes a
--            brief ACCESS EXCLUSIVE lock only (PostgreSQL 11+ metadata-only);
--            the new FK validates against a column that is NULL in every
--            existing row.

-- CreateTable
CREATE TABLE "floor_plan_areas" (
    "id" UUID NOT NULL,
    "floor_plan_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "color" VARCHAR(7) NOT NULL,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "floor_plan_areas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "floor_plan_areas_floor_plan_id_idx" ON "floor_plan_areas"("floor_plan_id");

-- CreateIndex
-- Exists solely as the target of the composite foreign key added to `tables`
-- below; `id` is already unique on its own.
CREATE UNIQUE INDEX "floor_plan_areas_floor_plan_id_id_key" ON "floor_plan_areas"("floor_plan_id", "id");

-- CreateIndex
-- Hand-written: Prisma's schema DSL cannot express a partial index. Area names
-- are unique per floor plan among LIVE rows only - unlike
-- `tables_branch_id_table_number_key`, a soft-deleted area releases its name
-- for reuse (ADR-040 decision #6). Mirrors `floor_plans_branch_id_active_key`.
CREATE UNIQUE INDEX "floor_plan_areas_floor_plan_id_name_key" ON "floor_plan_areas"("floor_plan_id", "name") WHERE "deleted_at" IS NULL;

-- AddForeignKey
ALTER TABLE "floor_plan_areas" ADD CONSTRAINT "floor_plan_areas_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable
ALTER TABLE "tables" ADD COLUMN     "floor_plan_area_id" UUID,
ADD COLUMN     "color" VARCHAR(7);

-- CreateIndex
CREATE INDEX "tables_floor_plan_area_id_idx" ON "tables"("floor_plan_area_id");

-- AddForeignKey
-- Composite on purpose (ADR-040 decision #4): a table can only reference an
-- area that lives in the table's OWN floor plan, which makes a cross-plan
-- assignment structurally impossible rather than merely rejected in code.
-- PostgreSQL's default MATCH SIMPLE semantics skip the check entirely while
-- "floor_plan_area_id" IS NULL, which is the intended behavior for a table that
-- is not assigned to any area.
ALTER TABLE "tables" ADD CONSTRAINT "tables_floor_plan_id_floor_plan_area_id_fkey" FOREIGN KEY ("floor_plan_id", "floor_plan_area_id") REFERENCES "floor_plan_areas"("floor_plan_id", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
