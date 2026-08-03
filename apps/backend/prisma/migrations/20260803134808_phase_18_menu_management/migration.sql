-- Phase 18 (Menu Management, architecture frozen 2026-08-02, ADR-031;
-- ownership/availability/isFeatured corrected 2026-08-03, ADR-032).
-- Seven new tables, purely additive - no existing table is altered.
--
-- One hand-written addition Prisma's schema DSL cannot express: a partial
-- UNIQUE index enforcing at most one `is_default = true`, non-soft-deleted
-- Menu per Restaurant (ADR-032 decision #1), added at the bottom of this
-- file - the exact same mechanism as ADR-026's
-- `tables_merge_group_one_primary_key`.
--
-- Rollback: drop the seven tables in child-to-parent order (menu_item_options,
--   menu_item_add_ons, menu_item_option_groups, menu_item_availability,
--   menu_items, menu_categories, menus), then
--   DROP TYPE "MenuItemAvailabilityMode"; DROP TYPE "MenuItemDietaryLabel";
-- Data impact: none - all seven tables are new, no existing data touched.
-- Downtime: none (pure additive CREATE TABLE/CREATE INDEX/ADD CONSTRAINT).

-- CreateEnum
CREATE TYPE "MenuItemAvailabilityMode" AS ENUM ('Always', 'Unavailable', 'Scheduled');

-- CreateEnum
CREATE TYPE "MenuItemDietaryLabel" AS ENUM ('Vegetarian', 'Vegan', 'Halal', 'GlutenFree', 'DairyFree');

-- CreateTable
CREATE TABLE "menus" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menus_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_categories" (
    "id" UUID NOT NULL,
    "menu_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "image_file_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_items" (
    "id" UUID NOT NULL,
    "category_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(10,2) NOT NULL,
    "currency" TEXT,
    "image_file_id" UUID,
    "availability_mode" "MenuItemAvailabilityMode" NOT NULL DEFAULT 'Always',
    "is_featured" BOOLEAN NOT NULL DEFAULT false,
    "preparation_time_minutes" INTEGER,
    "spicy_level" INTEGER,
    "calories" INTEGER,
    "allergens" TEXT[],
    "dietary_labels" "MenuItemDietaryLabel"[],
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_availability" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "start_time" TEXT NOT NULL,
    "end_time" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "menu_item_availability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_option_groups" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "min_selections" INTEGER NOT NULL DEFAULT 0,
    "max_selections" INTEGER NOT NULL DEFAULT 1,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_item_option_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_options" (
    "id" UUID NOT NULL,
    "option_group_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price_modifier" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_item_options_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "menu_item_add_ons" (
    "id" UUID NOT NULL,
    "menu_item_id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(10,2) NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "menu_item_add_ons_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "menus_restaurant_id_idx" ON "menus"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_categories_menu_id_idx" ON "menu_categories"("menu_id");

-- CreateIndex
CREATE INDEX "menu_categories_restaurant_id_idx" ON "menu_categories"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_categories_menu_id_display_order_idx" ON "menu_categories"("menu_id", "display_order");

-- CreateIndex
CREATE INDEX "menu_items_category_id_idx" ON "menu_items"("category_id");

-- CreateIndex
CREATE INDEX "menu_items_restaurant_id_idx" ON "menu_items"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_items_category_id_display_order_idx" ON "menu_items"("category_id", "display_order");

-- CreateIndex
CREATE INDEX "menu_item_availability_menu_item_id_idx" ON "menu_item_availability"("menu_item_id");

-- CreateIndex
CREATE INDEX "menu_item_availability_restaurant_id_idx" ON "menu_item_availability"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_item_availability_menu_item_id_day_of_week_idx" ON "menu_item_availability"("menu_item_id", "day_of_week");

-- CreateIndex
CREATE INDEX "menu_item_option_groups_menu_item_id_idx" ON "menu_item_option_groups"("menu_item_id");

-- CreateIndex
CREATE INDEX "menu_item_option_groups_restaurant_id_idx" ON "menu_item_option_groups"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_item_option_groups_menu_item_id_display_order_idx" ON "menu_item_option_groups"("menu_item_id", "display_order");

-- CreateIndex
CREATE INDEX "menu_item_options_option_group_id_idx" ON "menu_item_options"("option_group_id");

-- CreateIndex
CREATE INDEX "menu_item_options_restaurant_id_idx" ON "menu_item_options"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_item_options_option_group_id_display_order_idx" ON "menu_item_options"("option_group_id", "display_order");

-- CreateIndex
CREATE INDEX "menu_item_add_ons_menu_item_id_idx" ON "menu_item_add_ons"("menu_item_id");

-- CreateIndex
CREATE INDEX "menu_item_add_ons_restaurant_id_idx" ON "menu_item_add_ons"("restaurant_id");

-- CreateIndex
CREATE INDEX "menu_item_add_ons_menu_item_id_display_order_idx" ON "menu_item_add_ons"("menu_item_id", "display_order");

-- AddForeignKey
ALTER TABLE "menus" ADD CONSTRAINT "menus_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_categories" ADD CONSTRAINT "menu_categories_menu_id_fkey" FOREIGN KEY ("menu_id") REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_items" ADD CONSTRAINT "menu_items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "menu_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_availability" ADD CONSTRAINT "menu_item_availability_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_option_groups" ADD CONSTRAINT "menu_item_option_groups_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_options" ADD CONSTRAINT "menu_item_options_option_group_id_fkey" FOREIGN KEY ("option_group_id") REFERENCES "menu_item_option_groups"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "menu_item_add_ons" ADD CONSTRAINT "menu_item_add_ons_menu_item_id_fkey" FOREIGN KEY ("menu_item_id") REFERENCES "menu_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Partial unique: exactly one non-soft-deleted Default Menu per Restaurant
-- (ADR-032 decision #1). Mirrors ADR-026's tables_merge_group_one_primary_key
-- verbatim - Prisma's schema DSL has no way to express a partial index, so
-- this is hand-written here rather than in schema.prisma.
CREATE UNIQUE INDEX "menus_restaurant_one_default_key"
  ON "menus" ("restaurant_id")
  WHERE "is_default" = true AND "deleted_at" IS NULL;
