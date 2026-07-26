-- Phase 7.5 (Reservation Waitlist, ADR-019, architecture frozen 2026-07-24):
-- adds the ReservationWaitlistEntry table (DATABASE_SCHEMA.md "Reservation
-- Waitlist Entries") and makes reservations.created_by nullable - null means
-- the Reservation was created by an automatic Waitlist promotion (System
-- actor, Phase 7.5 freeze item 4), never a placeholder id. Every existing
-- row (Phase 7.1-7.4) already has created_by set, so this is a safe,
-- non-lossy relaxation with no backfill required.

-- CreateEnum
CREATE TYPE "WaitlistStatus" AS ENUM ('Waiting', 'Notified', 'Converted', 'Cancelled', 'Expired');

-- AlterTable
ALTER TABLE "reservations" ALTER COLUMN "created_by" DROP NOT NULL;

-- CreateTable
CREATE TABLE "reservation_waitlist_entries" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "user_id" UUID,
    "reservation_guest_id" UUID,
    "party_size" INTEGER NOT NULL,
    "preferred_date" DATE NOT NULL,
    "preferred_time_from" TIME NOT NULL,
    "preferred_time_to" TIME,
    "status" "WaitlistStatus" NOT NULL DEFAULT 'Waiting',
    "position" INTEGER NOT NULL,
    "converted_reservation_id" UUID,
    "notified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "reservation_waitlist_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "reservation_waitlist_entries_converted_reservation_id_key" ON "reservation_waitlist_entries"("converted_reservation_id");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_organization_id_idx" ON "reservation_waitlist_entries"("organization_id");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_branch_id_idx" ON "reservation_waitlist_entries"("branch_id");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_status_idx" ON "reservation_waitlist_entries"("status");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_branch_id_preferred_date_statu_idx" ON "reservation_waitlist_entries"("branch_id", "preferred_date", "status");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_branch_id_status_position_idx" ON "reservation_waitlist_entries"("branch_id", "status", "position");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_user_id_idx" ON "reservation_waitlist_entries"("user_id");

-- CreateIndex
CREATE INDEX "reservation_waitlist_entries_reservation_guest_id_idx" ON "reservation_waitlist_entries"("reservation_guest_id");

-- AddForeignKey
ALTER TABLE "reservation_waitlist_entries" ADD CONSTRAINT "reservation_waitlist_entries_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_waitlist_entries" ADD CONSTRAINT "reservation_waitlist_entries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_waitlist_entries" ADD CONSTRAINT "reservation_waitlist_entries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_waitlist_entries" ADD CONSTRAINT "reservation_waitlist_entries_reservation_guest_id_fkey" FOREIGN KEY ("reservation_guest_id") REFERENCES "reservation_guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservation_waitlist_entries" ADD CONSTRAINT "reservation_waitlist_entries_converted_reservation_id_fkey" FOREIGN KEY ("converted_reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Phase 7.5 decision (mirrors reservations_party_xor_chk, Phase 7.4 decision
-- #5): reservation-party invariant, enforced at the database layer in
-- addition to the domain layer (ReservationWaitlistEntry.validateParty) -
-- exactly one of user_id/reservation_guest_id must be set, never both, never
-- neither. Not expressible in schema.prisma (MIGRATION_POLICY.md).
ALTER TABLE "reservation_waitlist_entries" ADD CONSTRAINT "reservation_waitlist_entries_party_xor_chk"
    CHECK (
        ("user_id" IS NOT NULL AND "reservation_guest_id" IS NULL)
        OR
        ("user_id" IS NULL AND "reservation_guest_id" IS NOT NULL)
    );

-- Phase 7.5 freeze item 13: queue scope is (branchId, preferredDate); at most
-- one active (Waiting/Notified) entry may hold a given position within that
-- scope. Not expressible in schema.prisma's @@unique (no partial WHERE
-- clause support) - raw SQL only, mirroring the floor_plans_branch_id_active_key
-- partial-unique-index precedent (Phase 6.1 migration). Concurrent Join
-- requests are additionally serialized by a transaction-scoped advisory lock
-- keyed by (branchId, preferredDate) before position is computed (same
-- pg_advisory_xact_lock technique as ADR-013, new lock namespace) - this
-- index is the database-level safety net, not the primary mechanism.
CREATE UNIQUE INDEX "reservation_waitlist_entries_active_position_key"
    ON "reservation_waitlist_entries" ("branch_id", "preferred_date", "position")
    WHERE "status" IN ('Waiting', 'Notified') AND "deleted_at" IS NULL;
