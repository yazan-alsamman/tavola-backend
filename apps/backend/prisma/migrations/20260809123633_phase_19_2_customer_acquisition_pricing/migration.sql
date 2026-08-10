-- Phase 19.2 (Customer Acquisition & Pricing Engine, architecture frozen
-- 2026-08-04, implemented 2026-08-09, ADR-033). Purely additive: two new
-- tables, four new enums, no changes to any existing table/column/enum.
--
-- Forward: creates customer_acquisitions / acquisition_pricing_rules with
--   their FKs/indexes (Prisma-generated below), plus two hand-written
--   additions Prisma's schema DSL cannot express (appended at the end of
--   this file): the userId/reservationGuestId XOR CHECK (mirrors
--   reservations_party_xor_chk, Phase 7.4) and the two partial unique
--   indexes enforcing "one active (non-Reversed) acquisition per
--   (Restaurant, Customer-Identity)" (ADR-033 §9, mirrors
--   tables_merge_group_one_primary_key, Phase 6).
-- Rollback: DROP TABLE "customer_acquisitions"; DROP TABLE
--   "acquisition_pricing_rules"; DROP TYPE "AcquisitionCreatedVia";
--   DROP TYPE "AcquisitionStatus"; DROP TYPE "PricingScopeType";
--   DROP TYPE "PricingFeeType"; (both partial indexes and the CHECK
--   constraint drop automatically with their table).
-- Data impact: none - both tables are new, zero existing rows affected.
-- Downtime: none (two new tables; no lock is taken on any existing table).

-- CreateEnum
CREATE TYPE "AcquisitionCreatedVia" AS ENUM ('Automatic', 'ManualPlatformAdminCorrection');

-- CreateEnum
CREATE TYPE "AcquisitionStatus" AS ENUM ('Recorded', 'Reversed');

-- CreateEnum
CREATE TYPE "PricingScopeType" AS ENUM ('Platform', 'Organization', 'Restaurant');

-- CreateEnum
CREATE TYPE "PricingFeeType" AS ENUM ('Flat', 'Percentage');

-- CreateTable
CREATE TABLE "customer_acquisitions" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "user_id" UUID,
    "reservation_guest_id" UUID,
    "source_reservation_id" UUID,
    "reservation_source" "ReservationSource",
    "created_via" "AcquisitionCreatedVia" NOT NULL DEFAULT 'Automatic',
    "status" "AcquisitionStatus" NOT NULL DEFAULT 'Recorded',
    "fee_amount" DECIMAL(12,2) NOT NULL,
    "fee_currency" TEXT NOT NULL,
    "pricing_rule_id" UUID NOT NULL,
    "recorded_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversed_at" TIMESTAMP(3),
    "reversed_by" UUID,
    "reversal_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_acquisitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "acquisition_pricing_rules" (
    "id" UUID NOT NULL,
    "scope_type" "PricingScopeType" NOT NULL,
    "scope_id" UUID,
    "fee_type" "PricingFeeType" NOT NULL DEFAULT 'Flat',
    "flat_amount" DECIMAL(12,2),
    "flat_currency" TEXT,
    "percentage_value" DECIMAL(5,2),
    "effective_from" TIMESTAMP(3) NOT NULL,
    "effective_to" TIMESTAMP(3),
    "label" TEXT NOT NULL,
    "created_by" UUID NOT NULL,
    "archived_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "acquisition_pricing_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "customer_acquisitions_restaurant_id_idx" ON "customer_acquisitions"("restaurant_id");

-- CreateIndex
CREATE INDEX "customer_acquisitions_recorded_at_idx" ON "customer_acquisitions"("recorded_at");

-- CreateIndex
CREATE INDEX "acquisition_pricing_rules_scope_type_scope_id_effective_fro_idx" ON "acquisition_pricing_rules"("scope_type", "scope_id", "effective_from");

-- CreateIndex
CREATE INDEX "acquisition_pricing_rules_archived_at_idx" ON "acquisition_pricing_rules"("archived_at");

-- AddForeignKey
ALTER TABLE "customer_acquisitions" ADD CONSTRAINT "customer_acquisitions_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_acquisitions" ADD CONSTRAINT "customer_acquisitions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_acquisitions" ADD CONSTRAINT "customer_acquisitions_reservation_guest_id_fkey" FOREIGN KEY ("reservation_guest_id") REFERENCES "reservation_guests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_acquisitions" ADD CONSTRAINT "customer_acquisitions_source_reservation_id_fkey" FOREIGN KEY ("source_reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "customer_acquisitions" ADD CONSTRAINT "customer_acquisitions_pricing_rule_id_fkey" FOREIGN KEY ("pricing_rule_id") REFERENCES "acquisition_pricing_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ADR-033 §1/§9: reservation-party invariant, mirrors reservations_party_xor_chk
-- (Phase 7.4) exactly - exactly one of user_id/reservation_guest_id must be
-- set, never both, never neither. Cannot be expressed in schema.prisma.
ALTER TABLE "customer_acquisitions" ADD CONSTRAINT "customer_acquisitions_party_xor_chk"
    CHECK (
        ("user_id" IS NOT NULL AND "reservation_guest_id" IS NULL)
        OR
        ("user_id" IS NULL AND "reservation_guest_id" IS NOT NULL)
    );

-- ADR-033 §9: uniqueness enforced by a database constraint, not application
-- logic alone - a partial unique index per identity-key column (one row per
-- (Restaurant, Customer-Identity) pair, ignoring already-Reversed rows, so a
-- reversal genuinely frees the slot for a fresh acquisition). Mirrors
-- tables_merge_group_one_primary_key (Phase 6) - Prisma's schema DSL cannot
-- express a partial WHERE clause on @@unique.
CREATE UNIQUE INDEX "customer_acquisitions_restaurant_user_active_key"
    ON "customer_acquisitions" ("restaurant_id", "user_id")
    WHERE "status" != 'Reversed' AND "user_id" IS NOT NULL;

CREATE UNIQUE INDEX "customer_acquisitions_restaurant_guest_active_key"
    ON "customer_acquisitions" ("restaurant_id", "reservation_guest_id")
    WHERE "status" != 'Reversed' AND "reservation_guest_id" IS NOT NULL;
