-- Data-only correction, no schema change.
-- restaurants.average_rating is a cached AVG(rating) over a restaurant's
-- active reviews, kept current by the Reviews module on every submit/delete.
-- Rows written before that (demo data) carried fixed values such as 4.60 with
-- zero reviews. Recompute every row from its reviews; NULL when it has none
-- (never 0), matching PrismaRestaurantRepository.recomputeAverageRating.
-- Re-running it is harmless: the result is always derived from reviews.
UPDATE restaurants r
SET average_rating = (
  SELECT AVG(rv.rating)::numeric(3,2)
  FROM reviews rv
  WHERE rv.restaurant_id = r.id AND rv.deleted_at IS NULL
)
WHERE r.average_rating IS DISTINCT FROM (
  SELECT AVG(rv.rating)::numeric(3,2)
  FROM reviews rv
  WHERE rv.restaurant_id = r.id AND rv.deleted_at IS NULL
);
