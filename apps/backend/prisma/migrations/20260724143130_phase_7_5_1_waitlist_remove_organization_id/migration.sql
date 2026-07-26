-- Phase 7.5 tenancy correction (forward corrective migration, 2026-07-24):
-- the original Phase 7.5 migration (`20260724141815_phase_7_5_reservation_waitlist`,
-- already applied - not edited, per MIGRATION_POLICY.md) gave
-- ReservationWaitlistEntry a required direct organization_id column. That is
-- structurally incompatible with Customer-facing Join: a Customer actor has
-- no bound TenantContext.organizationId, and Restaurant (the only path to
-- discover one) is a DIRECT_TENANT_OWNED_MODEL, fail-closed
-- (TenantContextMissingException) with no context bound - there is no
-- legitimate way to populate this column for a Customer-initiated row
-- without either bypassing tenant scoping or requiring the Customer to
-- already know their own organization id, which they do not have. No row
-- exists yet at the time of this correction (Phase 7.5 was still mid-
-- implementation - see prisma/migrations/README or TASKS.md's Phase 7.5
-- report for the full account), so this is a clean, lossless drop, not a
-- backfill. Tenant ownership is resolved transitively instead
-- (branchId -> Branch.restaurantId -> Restaurant.organizationId), exactly
-- like Reservation itself already does - not registered in
-- withTenantScoping's DIRECT_TENANT_OWNED_MODELS.

/*
  Warnings:

  - You are about to drop the column `organization_id` on the `reservation_waitlist_entries` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "reservation_waitlist_entries_organization_id_idx";

-- AlterTable
ALTER TABLE "reservation_waitlist_entries" DROP COLUMN "organization_id";
