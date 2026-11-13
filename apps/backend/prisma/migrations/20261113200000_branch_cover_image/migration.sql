-- ADR-051: each branch has its own cover image. Existing branches start with
-- the restaurant cover (the same file), so nothing customers see changes
-- until a branch uploads its own.

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "cover_image_id" UUID;

-- Data
UPDATE "branches" b
SET "cover_image_id" = r."cover_image_id"
FROM "restaurants" r
WHERE b."restaurant_id" = r."id"
  AND b."deleted_at" IS NULL;
