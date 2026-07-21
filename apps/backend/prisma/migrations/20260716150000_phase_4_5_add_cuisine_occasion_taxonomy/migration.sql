-- CreateTable
CREATE TABLE "cuisine_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cuisine_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_cuisine_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "cuisine_category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_cuisine_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "occasion_categories" (
    "id" UUID NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "occasion_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "restaurant_occasion_categories" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "occasion_category_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "restaurant_occasion_categories_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cuisine_categories_slug_key" ON "cuisine_categories"("slug");

-- CreateIndex
CREATE INDEX "cuisine_categories_is_active_idx" ON "cuisine_categories"("is_active");

-- CreateIndex
CREATE INDEX "restaurant_cuisine_categories_cuisine_category_id_idx" ON "restaurant_cuisine_categories"("cuisine_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_cuisine_category_unique" ON "restaurant_cuisine_categories"("restaurant_id", "cuisine_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "occasion_categories_slug_key" ON "occasion_categories"("slug");

-- CreateIndex
CREATE INDEX "occasion_categories_is_active_idx" ON "occasion_categories"("is_active");

-- CreateIndex
CREATE INDEX "restaurant_occasion_categories_occasion_category_id_idx" ON "restaurant_occasion_categories"("occasion_category_id");

-- CreateIndex
CREATE UNIQUE INDEX "restaurant_occasion_category_unique" ON "restaurant_occasion_categories"("restaurant_id", "occasion_category_id");

-- AddForeignKey
ALTER TABLE "restaurant_cuisine_categories" ADD CONSTRAINT "restaurant_cuisine_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_cuisine_categories" ADD CONSTRAINT "restaurant_cuisine_categories_cuisine_category_id_fkey" FOREIGN KEY ("cuisine_category_id") REFERENCES "cuisine_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_occasion_categories" ADD CONSTRAINT "restaurant_occasion_categories_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "restaurant_occasion_categories" ADD CONSTRAINT "restaurant_occasion_categories_occasion_category_id_fkey" FOREIGN KEY ("occasion_category_id") REFERENCES "occasion_categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
