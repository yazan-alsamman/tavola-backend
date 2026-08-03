-- AlterTable
ALTER TABLE "SystemConfiguration" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "restaurant_usage" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "subscription_usage" ADD COLUMN     "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateIndex
CREATE INDEX "employees_user_id_idx" ON "employees"("user_id");

-- CreateIndex
CREATE INDEX "employees_role_id_idx" ON "employees"("role_id");
