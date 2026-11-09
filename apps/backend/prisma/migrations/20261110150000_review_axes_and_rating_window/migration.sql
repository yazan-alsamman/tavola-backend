-- CR WJ-R-2026-002 round 2 (ADR-045): three-axis reviews, a private note,
-- re-rating, and a restaurant rating over the last 6 months.

ALTER TABLE "reviews"
  ADD COLUMN "score" DECIMAL(3,2),
  ADD COLUMN "service_rating" INTEGER,
  ADD COLUMN "place_rating" INTEGER,
  ADD COLUMN "food_rating" INTEGER,
  ADD COLUMN "service_comment" TEXT,
  ADD COLUMN "place_comment" TEXT,
  ADD COLUMN "food_comment" TEXT,
  ADD COLUMN "private_note" TEXT,
  ADD COLUMN "reopened_at" TIMESTAMP(3),
  ADD COLUMN "rerated_at" TIMESTAMP(3);

-- Existing reviews are single-rating reviews: their score is their rating.
UPDATE "reviews" SET "score" = "rating";
ALTER TABLE "reviews" ALTER COLUMN "score" SET NOT NULL;

ALTER TABLE "reviews"
  ADD CONSTRAINT "reviews_axes_all_or_none" CHECK (
    ("service_rating" IS NULL AND "place_rating" IS NULL AND "food_rating" IS NULL)
    OR ("service_rating" IS NOT NULL AND "place_rating" IS NOT NULL AND "food_rating" IS NOT NULL)
  ),
  ADD CONSTRAINT "reviews_axis_ratings_range" CHECK (
    ("service_rating" IS NULL OR "service_rating" BETWEEN 1 AND 5)
    AND ("place_rating" IS NULL OR "place_rating" BETWEEN 1 AND 5)
    AND ("food_rating" IS NULL OR "food_rating" BETWEEN 1 AND 5)
  );

CREATE INDEX "reviews_restaurant_id_created_at_idx" ON "reviews"("restaurant_id", "created_at");

ALTER TABLE "restaurants" ADD COLUMN "rating_count" INTEGER NOT NULL DEFAULT 0;

-- Recompute every restaurant from its real reviews: no stale or seeded
-- average survives (a restaurant with no reviews showed 4.6).
WITH windowed AS (
  SELECT "restaurant_id", COUNT(*)::int AS cnt, AVG("score") AS avg_score
  FROM "reviews"
  WHERE "deleted_at" IS NULL AND "created_at" >= NOW() - INTERVAL '6 months'
  GROUP BY "restaurant_id"
)
UPDATE "restaurants" r
SET "rating_count" = COALESCE(w.cnt, 0),
    "average_rating" = CASE WHEN COALESCE(w.cnt, 0) >= 5 THEN ROUND(w.avg_score, 2) ELSE NULL END
FROM "restaurants" r2
LEFT JOIN windowed w ON w."restaurant_id" = r2."id"
WHERE r."id" = r2."id";
