-- Phase 7.4 (Phone & Walk-In Reservations, architecture frozen 2026-07-23):
-- adds the ReservationGuest table (DATABASE_SCHEMA.md "Reservation Guests"),
-- the real FK from reservations.reservation_guest_id (previously a plain,
-- FK-less nullable column since the Phase 7.1 migration), and the
-- reservation-party invariant (Phase 7.4 decision #5) - exactly one of
-- user_id/reservation_guest_id must be set, never both, never neither.
-- Every existing row (Phase 7.1-7.3, Online source only) already has
-- user_id set and reservation_guest_id null, so this CHECK is satisfied by
-- all existing data with no backfill required.
-- CreateTable
CREATE TABLE "reservation_guests" (
    "id" UUID NOT NULL,
    "full_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "anonymized_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reservation_guests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reservation_guests_phone_idx" ON "reservation_guests"("phone");

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_reservation_guest_id_fkey" FOREIGN KEY ("reservation_guest_id") REFERENCES "reservation_guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Phase 7.4 decision #5: reservation-party invariant, enforced at the
-- database layer in addition to the domain layer (Reservation.validateParty).
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_party_xor_chk"
    CHECK (
        ("user_id" IS NOT NULL AND "reservation_guest_id" IS NULL)
        OR
        ("user_id" IS NULL AND "reservation_guest_id" IS NOT NULL)
    );
