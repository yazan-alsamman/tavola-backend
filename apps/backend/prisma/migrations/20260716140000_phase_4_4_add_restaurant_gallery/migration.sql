-- CreateTable
CREATE TABLE "restaurant_gallery" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "file_id" UUID NOT NULL,
    "caption" TEXT,
    "sort_order" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "restaurant_gallery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "restaurant_gallery_restaurant_id_idx" ON "restaurant_gallery"("restaurant_id");

-- AddForeignKey
ALTER TABLE "restaurant_gallery" ADD CONSTRAINT "restaurant_gallery_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
