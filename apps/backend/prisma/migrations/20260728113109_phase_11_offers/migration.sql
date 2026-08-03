-- CreateEnum
CREATE TYPE "OfferType" AS ENUM ('Promotion', 'Coupon', 'Event');

-- CreateEnum
CREATE TYPE "OfferDiscountType" AS ENUM ('Percentage', 'FixedAmount');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('Draft', 'Published', 'Expired');

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "type" "OfferType" NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "discount_type" "OfferDiscountType" NOT NULL,
    "discount_value" DECIMAL(10,2) NOT NULL,
    "starts_at" TIMESTAMP(3) NOT NULL,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'Draft',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "offers_restaurant_id_idx" ON "offers"("restaurant_id");

-- CreateIndex
CREATE INDEX "offers_restaurant_id_status_idx" ON "offers"("restaurant_id", "status");

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
