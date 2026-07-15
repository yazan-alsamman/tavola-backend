-- CreateTable
CREATE TABLE "working_hours" (
    "id" UUID NOT NULL,
    "restaurant_id" UUID NOT NULL,
    "day_of_week" INTEGER NOT NULL,
    "opening_time" TEXT NOT NULL,
    "closing_time" TEXT NOT NULL,
    "break_start_time" TEXT,
    "break_end_time" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "working_hours_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "working_hours_restaurant_id_idx" ON "working_hours"("restaurant_id");

-- CreateIndex
CREATE UNIQUE INDEX "working_hours_restaurant_id_day_of_week_key" ON "working_hours"("restaurant_id", "day_of_week");

-- AddForeignKey
ALTER TABLE "working_hours" ADD CONSTRAINT "working_hours_restaurant_id_fkey" FOREIGN KEY ("restaurant_id") REFERENCES "restaurants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
