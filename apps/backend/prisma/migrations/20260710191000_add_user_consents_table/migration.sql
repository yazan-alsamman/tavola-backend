-- Phase 2.12 blocker fix: UserConsent persistence (Registration currently records
-- consents only in-memory — see docs/DATABASE_SCHEMA.md, ADR-014 §6, AUTHENTICATION_ARCHITECTURE.md §1.2.
--
-- Forward: adds the ConsentType enum and the user_consents table (additive only).
-- Rollback: DROP TABLE "user_consents"; DROP TYPE "ConsentType"; (tier 1 — reversible, no
--   other table references user_consents).
-- Data impact: none (new table, no backfill).
-- Downtime: none (additive CREATE TABLE / CREATE TYPE).

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('TermsOfService', 'PrivacyPolicy', 'Marketing');

-- CreateTable
CREATE TABLE "user_consents" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "consent_type" "ConsentType" NOT NULL,
    "terms_version" TEXT NOT NULL,
    "consented_at" TIMESTAMP(3) NOT NULL,
    "ip_address" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_consents_user_id_idx" ON "user_consents"("user_id");

-- AddForeignKey
ALTER TABLE "user_consents" ADD CONSTRAINT "user_consents_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
