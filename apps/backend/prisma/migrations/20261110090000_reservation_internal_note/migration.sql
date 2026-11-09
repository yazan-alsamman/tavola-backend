-- CR WJ-R-2026-002 round 2: staff-only internal note on a reservation
-- (special request, allergy). Never shown to the customer. Additive and
-- nullable, so existing rows and older clients are unaffected.
ALTER TABLE "reservations" ADD COLUMN "internal_note" VARCHAR(1000);
