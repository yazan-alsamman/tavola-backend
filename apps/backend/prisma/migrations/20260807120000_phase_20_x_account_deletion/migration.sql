-- AlterEnum
ALTER TYPE "SessionRevokeReason" ADD VALUE 'account_deletion';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deletion_requested_at" TIMESTAMP(3),
ADD COLUMN     "scheduled_anonymization_at" TIMESTAMP(3);
