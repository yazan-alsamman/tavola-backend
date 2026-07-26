-- Phase 6 (Merge/Split Tables, architecture frozen 2026-07-25, ADR-026).
-- Purely additive: extends TableStatus with `Merged` (secondaries only,
-- never set via POST /tables/{tableId}/status) and adds `is_merge_primary`,
-- which marks exactly one member of an active merge_group_id group as the
-- Primary Table (Reservation.tableId for the merged unit is always the
-- primary's id). Two hand-written constraints Prisma's schema DSL cannot
-- express: a CHECK enforcing `merge_group_id IS NULL => is_merge_primary =
-- false`, and a partial UNIQUE index enforcing at most one primary per
-- active group.
--
-- Forward: adds one enum value and one NOT NULL boolean column (with a
--   default, so existing rows backfill atomically), plus one CHECK
--   constraint and one partial unique index.
-- Rollback: DROP INDEX "tables_merge_group_one_primary_key";
--   ALTER TABLE "tables" DROP CONSTRAINT "tables_merge_primary_requires_group_check";
--   ALTER TABLE "tables" DROP COLUMN "is_merge_primary";
--   (the added TableStatus enum value cannot be removed by PostgreSQL - tier
--   2, forward-only, matching the Phase 7.2 `Reserved` precedent).
-- Data impact: none - existing rows backfill to is_merge_primary = false.
-- Downtime: none (ADD COLUMN ... NOT NULL ... DEFAULT ... is a metadata-only
--   change on PostgreSQL 11+; the CHECK and partial index are cheap given
--   Table's expected row counts).

-- AlterEnum
ALTER TYPE "TableStatus" ADD VALUE 'Merged';

-- AlterTable
ALTER TABLE "tables" ADD COLUMN "is_merge_primary" BOOLEAN NOT NULL DEFAULT false;

-- CHECK: merge_group_id IS NULL => is_merge_primary = false
ALTER TABLE "tables" ADD CONSTRAINT "tables_merge_primary_requires_group_check"
  CHECK ("merge_group_id" IS NOT NULL OR "is_merge_primary" = false);

-- Partial unique: exactly one primary per active merge group
CREATE UNIQUE INDEX "tables_merge_group_one_primary_key"
  ON "tables" ("merge_group_id")
  WHERE "is_merge_primary" = true AND "merge_group_id" IS NOT NULL;
