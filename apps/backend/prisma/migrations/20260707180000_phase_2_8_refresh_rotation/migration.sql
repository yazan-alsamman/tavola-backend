-- Phase 2.8: refresh-token rotation replay detection support
-- Additive migration — stores the immediately superseded refresh hash for reuse detection.

ALTER TABLE "device_sessions"
ADD COLUMN "previous_refresh_token_hash" TEXT;

CREATE INDEX "device_sessions_previous_refresh_token_hash_idx"
ON "device_sessions"("previous_refresh_token_hash");
