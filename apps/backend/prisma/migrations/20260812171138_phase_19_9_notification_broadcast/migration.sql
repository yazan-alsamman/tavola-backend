-- CreateEnum
CREATE TYPE "NotificationBroadcastSenderType" AS ENUM ('PlatformAdmin', 'OrganizationMember');

-- CreateEnum
CREATE TYPE "NotificationBroadcastStatus" AS ENUM ('Pending', 'Processing', 'Completed', 'Failed');

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "broadcast_id" UUID;

-- CreateTable
CREATE TABLE "notification_broadcasts" (
    "id" UUID NOT NULL,
    "sender_type" "NotificationBroadcastSenderType" NOT NULL,
    "sender_id" UUID NOT NULL,
    "organization_id" UUID,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "total_recipients" INTEGER,
    "processed_count" INTEGER NOT NULL DEFAULT 0,
    "succeeded_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "status" "NotificationBroadcastStatus" NOT NULL DEFAULT 'Pending',
    "last_processed_user_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "notification_broadcasts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "notification_broadcasts_status_idx" ON "notification_broadcasts"("status");

-- CreateIndex
CREATE UNIQUE INDEX "notifications_broadcast_id_user_id_key" ON "notifications"("broadcast_id", "user_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_broadcast_id_fkey" FOREIGN KEY ("broadcast_id") REFERENCES "notification_broadcasts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

