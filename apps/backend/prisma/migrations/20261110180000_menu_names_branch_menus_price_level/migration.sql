-- CR WJ-R-2026-002 round 2, batch 4 (ADR-046): item names in Arabic and
-- English, a menu per branch or shared, and a computed price level per branch.

-- Item names. `name` stays (app 1.0.2 reads it): the Arabic name, else the English one.
ALTER TABLE "menu_items" ADD COLUMN "name_ar" TEXT, ADD COLUMN "name_en" TEXT;
UPDATE "menu_items" SET "name_ar" = "name" WHERE "name" ~ '[؀-ۿ]';
UPDATE "menu_items" SET "name_en" = "name" WHERE "name_ar" IS NULL;

-- A menu belongs to one branch, or to every branch when branch_id is null.
ALTER TABLE "menus" ADD COLUMN "branch_id" UUID;
ALTER TABLE "menus" ADD CONSTRAINT "menus_branch_id_fkey"
  FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "menus_branch_id_idx" ON "menus"("branch_id");

-- One default menu per scope: the shared scope, and each branch.
DROP INDEX "menus_restaurant_one_default_key";
CREATE UNIQUE INDEX "menus_restaurant_one_default_key"
  ON "menus" ("restaurant_id", COALESCE("branch_id", '00000000-0000-0000-0000-000000000000'::uuid))
  WHERE "is_default" = true AND "deleted_at" IS NULL;

-- Computed price level per branch.
ALTER TABLE "branches" ADD COLUMN "reference_price" DECIMAL(10,2), ADD COLUMN "price_level" INTEGER;
ALTER TABLE "branches" ADD CONSTRAINT "branches_price_level_range"
  CHECK ("price_level" IS NULL OR "price_level" BETWEEN 1 AND 4);
