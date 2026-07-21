-- CreateEnum
CREATE TYPE "TableStatus" AS ENUM ('Available');

-- CreateEnum
CREATE TYPE "TableShape" AS ENUM ('Rectangle', 'Round');

-- CreateTable
CREATE TABLE "floor_plans" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "floor_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tables" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "floor_plan_id" UUID NOT NULL,
    "table_number" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "floor" INTEGER,
    "position_x" DOUBLE PRECISION,
    "position_y" DOUBLE PRECISION,
    "width" DOUBLE PRECISION,
    "height" DOUBLE PRECISION,
    "rotation" DOUBLE PRECISION,
    "shape" "TableShape" NOT NULL DEFAULT 'Rectangle',
    "layer" INTEGER,
    "indoor" BOOLEAN NOT NULL DEFAULT true,
    "vip" BOOLEAN NOT NULL DEFAULT false,
    "smoking" BOOLEAN NOT NULL DEFAULT false,
    "status" "TableStatus" NOT NULL DEFAULT 'Available',
    "merge_group_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "tables_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "floor_plans_branch_id_idx" ON "floor_plans"("branch_id");

-- CreateIndex
-- Partial unique index (not expressible in Prisma's schema DSL): at most one
-- active FloorPlan per Branch, DATABASE_SCHEMA.md "Floor Plans" Indexes /
-- TASKS.md Phase 6.1 decision #5. Excludes soft-deleted rows so a
-- soft-deleted FloorPlan's stale isActive value can never block activation
-- of a live one.
CREATE UNIQUE INDEX "floor_plans_branch_id_active_key" ON "floor_plans"("branch_id") WHERE "is_active" = true AND "deleted_at" IS NULL;

-- CreateIndex
CREATE INDEX "tables_branch_id_idx" ON "tables"("branch_id");

-- CreateIndex
CREATE INDEX "tables_floor_plan_id_idx" ON "tables"("floor_plan_id");

-- CreateIndex
CREATE INDEX "tables_status_idx" ON "tables"("status");

-- CreateIndex
CREATE INDEX "tables_merge_group_id_idx" ON "tables"("merge_group_id");

-- CreateIndex
CREATE UNIQUE INDEX "tables_branch_id_table_number_key" ON "tables"("branch_id", "table_number");

-- AddForeignKey
ALTER TABLE "floor_plans" ADD CONSTRAINT "floor_plans_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tables" ADD CONSTRAINT "tables_floor_plan_id_fkey" FOREIGN KEY ("floor_plan_id") REFERENCES "floor_plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;
