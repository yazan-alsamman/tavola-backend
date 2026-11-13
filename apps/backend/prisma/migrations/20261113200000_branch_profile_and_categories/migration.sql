-- ADR-051: each branch owns its name, description, cover image and categories.
-- Existing restaurant values are copied onto every live branch, so nothing a
-- customer sees changes until a branch is edited.

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "cover_image_id" UUID,
ADD COLUMN     "description" TEXT,
ADD COLUMN     "name" TEXT;

-- CreateTable
CREATE TABLE "branch_cuisine_categories" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "cuisine_category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_cuisine_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch_occasion_categories" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "occasion_category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "branch_occasion_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_cuisine_categories_cuisine_category_id_idx" ON "branch_cuisine_categories"("cuisine_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_cuisine_category_unique" ON "branch_cuisine_categories"("branch_id", "cuisine_category_id");

-- CreateIndex
CREATE INDEX "branch_occasion_categories_occasion_category_id_idx" ON "branch_occasion_categories"("occasion_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "branch_occasion_category_unique" ON "branch_occasion_categories"("branch_id", "occasion_category_id");

-- AddForeignKey
ALTER TABLE "branch_cuisine_categories" ADD CONSTRAINT "branch_cuisine_categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_cuisine_categories" ADD CONSTRAINT "branch_cuisine_categories_cuisine_category_id_fkey" FOREIGN KEY ("cuisine_category_id") REFERENCES "cuisine_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_occasion_categories" ADD CONSTRAINT "branch_occasion_categories_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "branch_occasion_categories" ADD CONSTRAINT "branch_occasion_categories_occasion_category_id_fkey" FOREIGN KEY ("occasion_category_id") REFERENCES "occasion_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Data: copy the restaurant profile onto each live branch.
UPDATE "branches" b
SET "name" = r."name",
    "description" = r."description",
    "cover_image_id" = r."cover_image_id"
FROM "restaurants" r
WHERE b."restaurant_id" = r."id"
  AND b."deleted_at" IS NULL;

-- Data: copy the restaurant category assignments onto each live branch.
INSERT INTO "branch_cuisine_categories" ("id", "branch_id", "cuisine_category_id", "created_at", "updated_at")
SELECT gen_random_uuid(), b."id", rc."cuisine_category_id", rc."created_at", CURRENT_TIMESTAMP
FROM "restaurant_cuisine_categories" rc
JOIN "branches" b ON b."restaurant_id" = rc."restaurant_id" AND b."deleted_at" IS NULL;

INSERT INTO "branch_occasion_categories" ("id", "branch_id", "occasion_category_id", "created_at", "updated_at")
SELECT gen_random_uuid(), b."id", ro."occasion_category_id", ro."created_at", CURRENT_TIMESTAMP
FROM "restaurant_occasion_categories" ro
JOIN "branches" b ON b."restaurant_id" = ro."restaurant_id" AND b."deleted_at" IS NULL;
