-- Phase 2.23 (ADR-022): Customer phone-first identity + Pending Customer
-- Registration + Customer phone-based password recovery.
--
-- Existing dev database checked before authoring this migration (11 existing
-- Users, zero duplicate phone/email values) - safe to add the new unique
-- constraints without a pre-migration data cleanup step.
--
-- users.email becomes nullable: only Restaurant Owner/staff accounts require
-- it going forward; Customer accounts never collect it. The existing
-- users_email_key unique constraint is left untouched by this migration
-- (PostgreSQL's UNIQUE already permits multiple NULLs, so no index change is
-- needed for email itself - only its NOT NULL constraint is dropped).
--
-- users.phone gains a unique constraint (previously a plain, non-unique
-- index) - Customer phone is now an authentication identity; Owner rows
-- with phone = NULL remain unconstrained by it.
--
-- users.username is new (nullable at the DB level; required in practice for
-- Customer accounts only, enforced at the application layer). Stored
-- lowercase-normalized by the application (mirrors the existing
-- OrganizationSlug normalize-then-unique-index precedent), so this plain
-- unique index enforces case-insensitive uniqueness without a citext
-- extension.
--
-- pending_customer_registrations and customer_password_reset_tokens are new
-- tables - see DECISIONS.md ADR-022 and DATABASE_SCHEMA.md for their
-- purpose and field-level rationale.

-- DropIndex
DROP INDEX "users_phone_idx";

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "username" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "pending_customer_registrations" (
    "id" UUID NOT NULL,
    "username" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_expires_at" TIMESTAMP(3) NOT NULL,
    "incorrect_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pending_customer_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "code_hash" TEXT NOT NULL,
    "code_expires_at" TIMESTAMP(3) NOT NULL,
    "incorrect_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "consumed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_customer_registrations_phone_key" ON "pending_customer_registrations"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "pending_customer_registrations_username_key" ON "pending_customer_registrations"("username");

-- CreateIndex
CREATE INDEX "customer_password_reset_tokens_user_id_idx" ON "customer_password_reset_tokens"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "users_phone_key" ON "users"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "users_username_key" ON "users"("username");

-- AddForeignKey
ALTER TABLE "customer_password_reset_tokens" ADD CONSTRAINT "customer_password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
