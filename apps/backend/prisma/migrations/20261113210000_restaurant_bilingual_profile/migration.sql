-- ADR-052: restaurant name and description in Arabic and English.
-- Existing text is filed under the language of its script; name/description stay as they are.

-- AlterTable
ALTER TABLE "restaurants" ADD COLUMN     "description_ar" TEXT,
ADD COLUMN     "description_en" TEXT,
ADD COLUMN     "name_ar" TEXT,
ADD COLUMN     "name_en" TEXT;


-- Data
UPDATE "restaurants"
SET "name_ar" = CASE WHEN "name" ~ '[؀-ۿ]' THEN "name" END,
    "name_en" = CASE WHEN "name" ~ '[؀-ۿ]' THEN NULL ELSE "name" END,
    "description_ar" = CASE WHEN "description" ~ '[؀-ۿ]' THEN "description" END,
    "description_en" = CASE WHEN "description" !~ '[؀-ۿ]' THEN NULLIF(btrim("description"), '') END;
