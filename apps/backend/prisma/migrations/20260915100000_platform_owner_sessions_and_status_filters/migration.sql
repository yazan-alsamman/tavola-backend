-- Platform Owner API completion.
--
-- 1. `platform_admin_sessions` — the session store that makes a real
--    refresh/logout lifecycle possible for the Platform Owner console.
--    ADR-022 originally froze Platform Admin access as stateless, which left
--    `logout` with nothing to revoke. Structurally isolated from
--    `device_sessions`: separate table, separate revoke-reason enum, read
--    only through `PlatformAdminSessionRepository`.
--
-- 2. Status indexes backing the new `status` filter on the Platform Owner
--    Restaurant/Organization list endpoints. Both are low-cardinality
--    columns always paired with pagination, so the index earns its keep on
--    the `ORDER BY created_at DESC LIMIT n` path rather than on selectivity.

-- CreateEnum
CREATE TYPE "PlatformAdminSessionRevokeReason" AS ENUM ('logout', 'reuse_detected', 'admin');

-- CreateTable
CREATE TABLE "platform_admin_sessions" (
    "id" UUID NOT NULL,
    "platform_admin_user_id" UUID NOT NULL,
    "refresh_token_hash" TEXT NOT NULL,
    "previous_refresh_token_hash" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "last_used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "revoked_reason" "PlatformAdminSessionRevokeReason",
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_admin_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "platform_admin_sessions_refresh_token_hash_key" ON "platform_admin_sessions"("refresh_token_hash");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_platform_admin_user_id_idx" ON "platform_admin_sessions"("platform_admin_user_id");

-- CreateIndex
CREATE INDEX "platform_admin_sessions_previous_refresh_token_hash_idx" ON "platform_admin_sessions"("previous_refresh_token_hash");

-- AddForeignKey
ALTER TABLE "platform_admin_sessions" ADD CONSTRAINT "platform_admin_sessions_platform_admin_user_id_fkey" FOREIGN KEY ("platform_admin_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "restaurants_status_idx" ON "restaurants"("status");

-- CreateIndex
CREATE INDEX "organizations_status_idx" ON "organizations"("status");
