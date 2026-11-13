-- Arabic display names for the platform-managed cuisine/occasion taxonomy.
-- Nullable and additive: values are filled by prisma/seed.ts, and clients
-- fall back to `name` while a row has none.
ALTER TABLE "cuisine_categories" ADD COLUMN "name_ar" TEXT;
ALTER TABLE "occasion_categories" ADD COLUMN "name_ar" TEXT;
