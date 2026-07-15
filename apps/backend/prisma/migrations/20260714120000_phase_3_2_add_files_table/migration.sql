-- CreateEnum
CREATE TYPE "FileOwnerType" AS ENUM ('User', 'Restaurant', 'Review', 'Menu');

-- CreateEnum
CREATE TYPE "FileAccessPolicy" AS ENUM ('Public', 'Private');

-- CreateTable
CREATE TABLE "files" (
    "id" UUID NOT NULL,
    "owner_id" UUID NOT NULL,
    "owner_type" "FileOwnerType" NOT NULL,
    "bucket" TEXT NOT NULL,
    "object_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "access_policy" "FileAccessPolicy" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "files_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "files_owner_type_owner_id_idx" ON "files"("owner_type", "owner_id");
