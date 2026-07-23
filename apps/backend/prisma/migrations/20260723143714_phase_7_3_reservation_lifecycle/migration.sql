-- Phase 7.3 (Reservation Lifecycle, architecture frozen 2026-07-23): adds
-- the append-only ReservationHistory audit trail, written by Cancel/
-- Reschedule/Complete/NoShow/Expire only (never retroactively by Approve/
-- Reject). `old_table_id`/`new_table_id` are populated only when Reschedule
-- actually changes the table; `within_cancellation_window` is populated only
-- by Cancel. `ON DELETE RESTRICT` matches DATABASE_SCHEMA.md's stated
-- retention intent - a Reservation's audit trail must never be silently
-- dropped by deleting the parent row.
CREATE TABLE "reservation_history" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "old_status" "ReservationStatus" NOT NULL,
    "new_status" "ReservationStatus" NOT NULL,
    "old_reservation_date" DATE,
    "old_reservation_start_time" TIMESTAMPTZ,
    "new_reservation_date" DATE,
    "new_reservation_start_time" TIMESTAMPTZ,
    "old_table_id" UUID,
    "new_table_id" UUID,
    "within_cancellation_window" BOOLEAN,
    "changed_by" UUID,
    "changed_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "reservation_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_history_reservation_id_idx" ON "reservation_history"("reservation_id");

-- AddForeignKey
ALTER TABLE "reservation_history" ADD CONSTRAINT "reservation_history_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
