-- CR WJ-R-2026-002 round 2, batch 4 (ADR-047): offer kinds, days and hours,
-- booking conditions, and a view counter for the impact card.

ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'BillDiscount';
ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'FreeItem';
ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'GroupPrice';
ALTER TYPE "OfferType" ADD VALUE IF NOT EXISTS 'QuietDays';

ALTER TABLE "offers"
  ADD COLUMN "days_of_week" INTEGER[] NOT NULL DEFAULT '{}',
  ADD COLUMN "start_time" TEXT,
  ADD COLUMN "end_time" TEXT,
  ADD COLUMN "min_party_size" INTEGER,
  ADD COLUMN "branch_ids" UUID[] NOT NULL DEFAULT '{}',
  ADD COLUMN "once_per_customer" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "booking_cap" INTEGER,
  ADD COLUMN "view_count" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "offers"
  ADD CONSTRAINT "offers_hours_both_or_none"
    CHECK (("start_time" IS NULL) = ("end_time" IS NULL)),
  ADD CONSTRAINT "offers_days_of_week_range"
    CHECK ("days_of_week" <@ ARRAY[0, 1, 2, 3, 4, 5, 6]),
  ADD CONSTRAINT "offers_min_party_size_positive"
    CHECK ("min_party_size" IS NULL OR "min_party_size" >= 1),
  ADD CONSTRAINT "offers_booking_cap_positive"
    CHECK ("booking_cap" IS NULL OR "booking_cap" >= 1);

-- An offer whose period ended while its expiration job was lost still read
-- "Published" in some places; settle every such row now.
UPDATE "offers"
SET "status" = 'Expired', "updated_at" = NOW()
WHERE "status" = 'Published' AND "ends_at" <= NOW() AND "deleted_at" IS NULL;
