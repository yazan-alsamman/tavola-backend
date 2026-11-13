-- ADR-050: working hours and currency belong to the branch, not the
-- restaurant. Data-only and forward-only; no column is dropped.

-- 1. Working hours. Until now a branch weekday without its own row fell back
--    to the restaurant row for that weekday. Copy those restaurant rows onto
--    every live branch for the weekdays it has no row of its own, so each
--    branch keeps exactly the schedule it had while bookings now read the
--    branch rows alone.
INSERT INTO "branch_working_hours" (
  "id", "branch_id", "day_of_week", "opening_time", "closing_time",
  "break_start_time", "break_end_time", "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), b."id", wh."day_of_week", wh."opening_time", wh."closing_time",
  wh."break_start_time", wh."break_end_time", NOW(), NOW()
FROM "branches" b
JOIN "working_hours" wh ON wh."restaurant_id" = b."restaurant_id"
WHERE b."deleted_at" IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM "branch_working_hours" bwh
    WHERE bwh."branch_id" = b."id" AND bwh."day_of_week" = wh."day_of_week"
  );

-- 2. Currency. A live branch with no currency of its own takes the
--    restaurant's default currency, which is no longer edited.
UPDATE "branches" b
SET "currency" = rs."default_currency", "updated_at" = NOW()
FROM "restaurant_settings" rs
WHERE rs."restaurant_id" = b."restaurant_id"
  AND b."deleted_at" IS NULL
  AND b."currency" IS NULL
  AND rs."default_currency" IS NOT NULL;
