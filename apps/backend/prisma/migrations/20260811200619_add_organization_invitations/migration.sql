-- CreateEnum
CREATE TYPE "OrganizationInvitationStatus" AS ENUM ('Pending', 'Accepted', 'Revoked');

-- CreateTable
CREATE TABLE "organization_invitations" (
    "id" UUID NOT NULL,
    "organization_id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "role" "OrganizationMemberRole" NOT NULL,
    "token_hash" TEXT NOT NULL,
    "invited_by_user_id" UUID NOT NULL,
    "status" "OrganizationInvitationStatus" NOT NULL DEFAULT 'Pending',
    "expires_at" TIMESTAMP(3) NOT NULL,
    "accepted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "organization_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "organization_invitations_token_hash_key" ON "organization_invitations"("token_hash");

-- CreateIndex
CREATE INDEX "organization_invitations_organization_id_idx" ON "organization_invitations"("organization_id");

-- CreateIndex
CREATE INDEX "organization_invitations_organization_id_email_idx" ON "organization_invitations"("organization_id", "email");

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "organization_invitations" ADD CONSTRAINT "organization_invitations_invited_by_user_id_fkey" FOREIGN KEY ("invited_by_user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Partial unique index: at most one Pending invitation per (organizationId,
-- email) at a time (MIGRATION_POLICY.md "Constraint changes" - verified no
-- violating rows possible on this brand-new, empty table). Prisma's schema
-- DSL cannot express a WHERE-filtered unique index - added by hand here,
-- mirroring the exact precedent already established for
-- "tables_merge_group_one_primary_key" / "menus_restaurant_one_default_key"
-- (see schema.prisma's Table/Menu comments). Re-inviting the same email
-- after a Revoke/Accept is unaffected (those rows no longer have
-- status = 'Pending'), so this enforces IssueOrganizationInvitationUseCase's
-- revoke-old-then-issue-new resend semantics at the database level, not only
-- in application code.
CREATE UNIQUE INDEX "organization_invitations_org_email_one_pending_key"
    ON "organization_invitations" ("organization_id", "email")
    WHERE "status" = 'Pending';
