-- Phase 19.1 (Platform Back Office Foundation, ADR-034 subset)

-- ADR-034 §1: AuditActorType gains PlatformAdmin, additive, prerequisite for
-- correct attribution of every capability this phase adds.
ALTER TYPE "AuditActorType" ADD VALUE 'PlatformAdmin';

-- ADR-034 §11: two-tier Platform role.
CREATE TYPE "PlatformAdminRole" AS ENUM ('PlatformAdmin', 'PlatformSupport');

-- ADR-034 §11: role is embedded in PlatformAdminClaims at token issuance;
-- existing rows default to the (strictly more privileged) PlatformAdmin role
-- so no currently-active admin silently loses authority on deploy.
ALTER TABLE "platform_admins" ADD COLUMN "role" "PlatformAdminRole" NOT NULL DEFAULT 'PlatformAdmin';
