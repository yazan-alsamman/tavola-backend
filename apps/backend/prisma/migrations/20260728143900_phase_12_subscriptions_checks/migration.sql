-- Phase 12 (Subscriptions, ADR-027) — nonnegative CHECK constraints.
-- Prisma's schema DSL has no native CHECK-constraint syntax in this
-- version, so these are added as a small, additive follow-up migration
-- immediately after the table-creation migration, per MIGRATION_POLICY.md's
-- "one concern per migration" guidance and "never modify an already-applied
-- migration" rule.

ALTER TABLE "subscription_plans"
  ADD CONSTRAINT "subscription_plans_max_restaurants_nonnegative" CHECK ("max_restaurants" >= 0),
  ADD CONSTRAINT "subscription_plans_max_branches_per_restaurant_nonnegative" CHECK ("max_branches_per_restaurant" >= 0),
  ADD CONSTRAINT "subscription_plans_max_employees_per_restaurant_nonnegative" CHECK ("max_employees_per_restaurant" >= 0);

ALTER TABLE "subscription_usage"
  ADD CONSTRAINT "subscription_usage_restaurant_count_nonnegative" CHECK ("restaurant_count" >= 0);

ALTER TABLE "restaurant_usage"
  ADD CONSTRAINT "restaurant_usage_branch_count_nonnegative" CHECK ("branch_count" >= 0),
  ADD CONSTRAINT "restaurant_usage_employee_count_nonnegative" CHECK ("employee_count" >= 0);
