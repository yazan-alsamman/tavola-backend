-- Two-step migration (post-audit remediation M5): the previous migration
-- (20260804150000_phase_19_1_platform_back_office_foundation) added
-- "platform_admins"."role" with DEFAULT 'PlatformAdmin', which backfilled
-- every pre-existing row to the more-privileged tier at that time (safe,
-- backward-compatible - no currently-active admin lost authority). This
-- second step drops that default now that the backfill has already
-- applied, so any future INSERT that omits "role" fails closed (NOT NULL
-- violation) instead of silently granting maximum privilege.
ALTER TABLE "platform_admins" ALTER COLUMN "role" DROP DEFAULT;
