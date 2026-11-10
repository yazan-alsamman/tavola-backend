-- CR WJ-R-2026-002 round 2: a reservation booked from an offer remembers it,
-- so the restaurant dashboard can show which bookings an offer brought in.
-- Nullable and additive: existing rows and older app builds are unaffected.
ALTER TABLE "reservations" ADD COLUMN "offer_id" UUID;

CREATE INDEX "reservations_offer_id_idx" ON "reservations"("offer_id");

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_offer_id_fkey"
  FOREIGN KEY ("offer_id") REFERENCES "offers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
