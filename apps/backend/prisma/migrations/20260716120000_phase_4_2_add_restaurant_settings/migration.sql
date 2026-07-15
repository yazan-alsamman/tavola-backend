-- Phase 4.2 (Restaurant Module: Restaurant Settings). See docs/DATABASE_SCHEMA.md
-- "Restaurant Settings" - a required 1:1 child entity of Restaurant, auto-created with
-- sensible defaults whenever a Restaurant is created (application-layer invariant, not
-- enforced by the schema itself, matching how a NOT NULL foreign key alone cannot express
-- "created atomically alongside its parent").
--
-- Forward: creates "restaurant_settings" (new table, one row per restaurant, unique FK)
--   with server-side defaults for every configuration field so a row can be created with
--   no explicit values and still be immediately valid.
-- Rollback: DROP TABLE "restaurant_settings"; (tier 1 - reversible, additive-only, no
--   other table references it).
-- Data impact: none - new table, no backfill (no restaurants existed with data-bearing
--   settings prior to this migration; any restaurant already created by Phase 4.1 code
--   before this migration remains valid, simply without a settings row, until updated by
--   an eventual data-fix migration if that ever becomes necessary - not required for a
--   pre-launch codebase with no production data).
-- Downtime: none (single CREATE TABLE + indexes + FK, no lock on existing tables).

-- CreateTable
CREATE TABLE "restaurant_settings" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "reservation_interval_minutes" INTEGER NOT NULL DEFAULT 30,
    "max_guests_per_reservation" INTEGER NOT NULL DEFAULT 20,
    "cancellation_window_minutes" INTEGER NOT NULL DEFAULT 60,
    "pending_reservation_timeout_minutes" INTEGER NOT NULL DEFAULT 15,
    "auto_approval" BOOLEAN NOT NULL DEFAULT false,
    "timezone" TEXT NOT NULL DEFAULT 'UTC',
    "default_currency" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_settings_restaurant_id_key" ON "restaurant_settings"("restaurant_id");

-- AddForeignKey
ALTER TABLE "restaurant_settings" ADD CONSTRAINT "restaurant_settings_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
