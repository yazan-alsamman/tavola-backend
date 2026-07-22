-- Phase 2.23 (ADR-022) follow-up: Customer registration never collects a
-- name (frozen identity is username + phone + password only). Mechanically
-- the same nullable-per-actor-field pattern already frozen for
-- email/phone/username, extended to first_name/last_name once
-- implementation revealed the same shared-User-table constraint applies to
-- them too (not a new product decision — ADR-022 never enumerated these
-- fields explicitly, so this is a mechanical consequence, not a reopening).

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "first_name" DROP NOT NULL,
ALTER COLUMN "last_name" DROP NOT NULL;
