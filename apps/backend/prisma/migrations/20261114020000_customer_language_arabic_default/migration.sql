-- ADR-054: customers default to Arabic so their notifications use the Arabic
-- templates. Data-only. A customer account is one with a username (ADR-022);
-- accounts that are also restaurant staff (organization member or employee)
-- keep their language.
UPDATE "users" u
SET "language" = 'ar', "updated_at" = NOW()
WHERE u."username" IS NOT NULL
  AND u."language" = 'en'
  AND NOT EXISTS (SELECT 1 FROM "organization_members" m WHERE m."user_id" = u."id")
  AND NOT EXISTS (SELECT 1 FROM "employees" e WHERE e."user_id" = u."id");
