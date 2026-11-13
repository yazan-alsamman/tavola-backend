-- ADR-053: venue type, features, per-branch plan state, temporary closures and
-- extra booking limits. Additive only; every new column is nullable or has a
-- default, so existing rows keep their current behaviour.

-- CreateEnum
CREATE TYPE "BranchVenueType" AS ENUM ('Restaurant', 'Cafe', 'Patisserie', 'Brunch');

-- CreateEnum
CREATE TYPE "BranchFeature" AS ENUM ('Shisha', 'OutdoorSeating', 'Heating', 'Parking', 'FamilyFriendly', 'PrivateRoom');

-- AlterTable
ALTER TABLE "branch_settings" ADD COLUMN     "auto_approval_max_guests" INTEGER,
ADD COLUMN     "daily_guest_cap" INTEGER,
ADD COLUMN     "max_days_ahead" INTEGER,
ADD COLUMN     "min_lead_time_minutes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "branches" ADD COLUMN     "features" "BranchFeature"[] DEFAULT ARRAY[]::"BranchFeature"[],
ADD COLUMN     "paused_at" TIMESTAMP(3),
ADD COLUMN     "trial_ends_at" TIMESTAMP(3),
ADD COLUMN     "venue_type" "BranchVenueType";

-- AlterTable
ALTER TABLE "restaurant_settings" ADD COLUMN     "auto_approval_max_guests" INTEGER,
ADD COLUMN     "daily_guest_cap" INTEGER,
ADD COLUMN     "max_days_ahead" INTEGER,
ADD COLUMN     "min_lead_time_minutes" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "branch_closures" (
    "id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "branch_closures_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "branch_closures_branch_id_end_date_idx" ON "branch_closures"("branch_id", "end_date");

-- AddForeignKey
ALTER TABLE "branch_closures" ADD CONSTRAINT "branch_closures_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

