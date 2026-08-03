-- Phase 18 implementation-time correction (2026-08-03): `Menu.name` was
-- missing from the ADR-032 field list even though distinguishing multiple
-- Menus (Breakfast/Lunch/Dinner/etc. - the entire motivation for ADR-032's
-- 1:N ownership change) is impossible without one. Purely additive, applied
-- within the same implementation session before any other code depended on
-- the prior shape - see DATABASE_SCHEMA.md's Menu Management note.
-- Rollback: ALTER TABLE "menus" DROP COLUMN "name";
-- Data impact: none (default backfills any existing row). Downtime: none.

-- AlterTable
ALTER TABLE "menus" ADD COLUMN     "name" TEXT NOT NULL DEFAULT 'Main Menu';
