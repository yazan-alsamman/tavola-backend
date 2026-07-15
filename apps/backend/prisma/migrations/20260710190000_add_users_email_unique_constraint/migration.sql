-- Phase 2.12 blocker fix: enforce database-level uniqueness for User.email.
-- See docs/DATABASE_SCHEMA.md, docs/AUTHENTICATION_ARCHITECTURE.md §1.2, ADR-014.
--
-- Forward: replaces the non-unique "users_email_idx" with a unique index.
-- Rollback: DROP INDEX "users_email_key"; CREATE INDEX "users_email_idx" ON "users"("email");
--   (rollback tier 1 — reversible, additive-only class of change per MIGRATION_POLICY.md,
--   though it would restore the pre-fix race condition).
-- Data impact: none (no rows dropped or rewritten).
-- Downtime: brief index-build lock, acceptable at current (pre-production) data volume;
--   a production cutover on a populated table should use CREATE UNIQUE INDEX CONCURRENTLY
--   followed by a NOT VALID -> VALIDATE style swap, per MIGRATION_POLICY.md "Safe Schema
--   Evolution Patterns" for constraint changes.
--
-- Pre-existing duplicate emails would make this migration fail outright (Postgres refuses
-- to build a unique index over violating rows) — that failure is the intended safety net,
-- not a bug: it forces duplicates to be resolved (e.g. via anonymization, ADR-014) before
-- the constraint can be enforced.

-- DropIndex
DROP INDEX "users_email_idx";

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
