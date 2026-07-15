-- Phase 3.4 (User Module: Preferences). See docs/DATABASE_SCHEMA.md "Users" table and
-- DECISIONS.md's reconciliation note: notificationOptIn/marketingOptIn are the only
-- Preferences fields genuinely missing from the User aggregate as already shipped in
-- Phase 3.1 (language/preferredCurrency already live on this same table) - the
-- previously-documented standalone UserPreference child-entity table was never
-- implemented and is corrected in this session's documentation sync rather than built.
--
-- Forward: adds two NOT NULL boolean columns to "users", each with a default so the
--   backfill for existing rows is implicit and atomic with the ADD COLUMN itself.
-- Rollback: ALTER TABLE "users" DROP COLUMN "notification_opt_in"; ALTER TABLE "users"
--   DROP COLUMN "marketing_opt_in"; (tier 1 - reversible, additive-only, no other table
--   references these columns).
-- Data impact: none - existing rows are backfilled to notification_opt_in = true,
--   marketing_opt_in = false (functional notifications on, marketing opt-in required,
--   the same GDPR-safe default RegistrationPolicy.createPendingUser now applies to new
--   users going forward).
-- Downtime: none (single-pass ADD COLUMN ... NOT NULL ... DEFAULT ... is a metadata-only
--   change on PostgreSQL 11+, no full-table rewrite).

-- AlterTable
ALTER TABLE "users" ADD COLUMN "notification_opt_in" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "users" ADD COLUMN "marketing_opt_in" BOOLEAN NOT NULL DEFAULT false;
