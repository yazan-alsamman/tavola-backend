-- ADR-051: reservation rules and gallery photos belong to each branch.

-- 1. Branch reservation rules.
CREATE TABLE "branch_settings" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "reservation_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_guests_per_reservation" INTEGER NOT NULL DEFAULT 20,
    "cancellation_window_minutes" INTEGER NOT NULL DEFAULT 60,
    "pending_reservation_timeout_minutes" INTEGER NOT NULL DEFAULT 15,
    "default_reservation_duration_minutes" INTEGER NOT NULL DEFAULT 90,
    "auto_approval" BOOLEAN NOT NULL DEFAULT false,
    "reservation_reminder_minutes_before" INTEGER NOT NULL DEFAULT 60,
    "late_arrival_grace_minutes" INTEGER NOT NULL DEFAULT 15,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "branch_settings_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "branch_settings_branch_id_key" ON "branch_settings"("branch_id");
ALTER TABLE "branch_settings" ADD CONSTRAINT "branch_settings_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Every live branch starts with its restaurant's current rules, so nothing
-- changes for any booking.
INSERT INTO "branch_settings" (
  "id", "branch_id", "reservation_interval_minutes", "max_guests_per_reservation",
  "cancellation_window_minutes", "pending_reservation_timeout_minutes",
  "default_reservation_duration_minutes", "auto_approval",
  "reservation_reminder_minutes_before", "late_arrival_grace_minutes",
  "created_at", "updated_at"
)
SELECT
  gen_random_uuid(), b."id", rs."reservation_interval_minutes", rs."max_guests_per_reservation",
  rs."cancellation_window_minutes", rs."pending_reservation_timeout_minutes",
  rs."default_reservation_duration_minutes", rs."auto_approval",
  rs."reservation_reminder_minutes_before", rs."late_arrival_grace_minutes",
  NOW(), NOW()
FROM "branches" b
JOIN "restaurant_settings" rs ON rs."restaurant_id" = b."restaurant_id"
WHERE b."deleted_at" IS NULL;

-- 2. Gallery photos per branch.
ALTER TABLE "restaurant_gallery" ADD COLUMN "branch_id" UUID;
CREATE INDEX "restaurant_gallery_branch_id_idx" ON "restaurant_gallery"("branch_id");

-- Every other live branch gets its own row for each existing photo (the
-- same stored file), in the same order...
INSERT INTO "restaurant_gallery" (
  "id", "restaurant_id", "branch_id", "file_id", "caption", "sort_order", "created_at", "updated_at"
)
SELECT gen_random_uuid(), g."restaurant_id", b."id", g."file_id", g."caption", g."sort_order", NOW(), NOW()
FROM "restaurant_gallery" g
JOIN "branches" b ON b."restaurant_id" = g."restaurant_id" AND b."deleted_at" IS NULL
WHERE g."branch_id" IS NULL
  AND b."id" <> (
    SELECT fb."id" FROM "branches" fb
    WHERE fb."restaurant_id" = g."restaurant_id" AND fb."deleted_at" IS NULL
    ORDER BY fb."created_at", fb."id" LIMIT 1
  );

-- ...and the existing rows move to the oldest live branch. A restaurant
-- without a branch keeps its rows with no branch.
UPDATE "restaurant_gallery" g
SET "branch_id" = (
  SELECT fb."id" FROM "branches" fb
  WHERE fb."restaurant_id" = g."restaurant_id" AND fb."deleted_at" IS NULL
  ORDER BY fb."created_at", fb."id" LIMIT 1
)
WHERE g."branch_id" IS NULL;
