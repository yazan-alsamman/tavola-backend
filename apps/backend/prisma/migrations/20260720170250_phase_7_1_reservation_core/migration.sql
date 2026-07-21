-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('Pending', 'Approved', 'Rejected', 'Cancelled', 'Completed', 'Expired', 'NoShow');

-- CreateEnum
CREATE TYPE "ReservationSource" AS ENUM ('Online', 'Phone', 'WalkIn', 'Staff', 'WaitlistConversion');

-- AlterTable
ALTER TABLE "restaurant_settings" ADD COLUMN     "default_reservation_duration_minutes" INTEGER NOT NULL DEFAULT 90;

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "reservation_guest_id" UUID,
    "restaurant_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "table_id" UUID NOT NULL,
    "reservation_date" DATE NOT NULL,
    "reservation_start_time" TIMESTAMPTZ NOT NULL,
    "reservation_end_time" TIMESTAMPTZ NOT NULL,
    "guests" INTEGER NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'Pending',
    "source" "ReservationSource" NOT NULL DEFAULT 'Online',
    "notes" TEXT,
    "created_by" UUID NOT NULL,
    "approved_by" UUID,
    "approved_at" TIMESTAMP(3),
    "cancelled_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "no_show_at" TIMESTAMP(3),
    "late_arrival_notified_at" TIMESTAMP(3),
    "table_ready_notified_at" TIMESTAMP(3),
    "rescheduled_from_reservation_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservations_reservation_date_idx" ON "reservations"("reservation_date");

-- CreateIndex
CREATE INDEX "reservations_table_id_idx" ON "reservations"("table_id");

-- CreateIndex
CREATE INDEX "reservations_branch_id_idx" ON "reservations"("branch_id");

-- CreateIndex
CREATE INDEX "reservations_status_idx" ON "reservations"("status");

-- CreateIndex
CREATE INDEX "reservations_branch_id_reservation_date_status_idx" ON "reservations"("branch_id", "reservation_date", "status");

-- CreateIndex
CREATE INDEX "reservations_table_id_reservation_date_reservation_start_ti_idx" ON "reservations"("table_id", "reservation_date", "reservation_start_time");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_table_id_fkey" FOREIGN KEY ("table_id") REFERENCES "tables"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR-013 (Reservation Concurrency Strategy) / MIGRATION_POLICY.md: extensions
-- must be enabled in a dedicated statement before dependent objects.
CREATE EXTENSION IF NOT EXISTS btree_gist;

-- ADR-013 database-level safety net, independent of the application-level
-- advisory lock. `Pending` is deliberately excluded from the guarded set
-- (2026-07-19 amendment) so two overlapping Pending reservations for the same
-- table may coexist, per DOMAIN_MODEL.md's own business rule - only
-- Approved/Completed/NoShow rows may never overlap for the same table.
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_no_overlapping_confirmed_excl"
    EXCLUDE USING gist (
        "table_id" WITH =,
        tstzrange("reservation_start_time", "reservation_end_time") WITH &&
    ) WHERE (status NOT IN ('Cancelled', 'Expired', 'Rejected', 'Pending'));
