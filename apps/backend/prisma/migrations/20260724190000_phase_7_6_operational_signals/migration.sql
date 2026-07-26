-- Phase 7.6 (Operational Signals, ADR-019). Adds the two per-restaurant
-- tuning knobs the Reminder/Late-Arrival BullMQ jobs read at schedule time:
-- reservationReminderMinutesBefore (how long before reservationStartTime the
-- ReservationReminderDue job fires) and lateArrivalGraceMinutes (how long
-- after reservationStartTime the Late-Arrival job fires, marking
-- lateArrivalNotifiedAt if the reservation is still Approved). Both are
-- NOT NULL with a server-side default matching RestaurantSettings.createDefault()
-- exactly, so existing rows are backfilled atomically with the ADD COLUMN
-- itself - no separate backfill statement needed.
--
-- Forward: adds two NOT NULL integer columns to "restaurant_settings", each
--   with a default (60 / 15 minutes respectively).
-- Rollback: ALTER TABLE "restaurant_settings" DROP COLUMN "reservation_reminder_minutes_before";
--   ALTER TABLE "restaurant_settings" DROP COLUMN "late_arrival_grace_minutes";
--   (tier 1 - reversible, additive-only, no other table references these columns).
-- Data impact: none - existing rows are backfilled to
--   reservation_reminder_minutes_before = 60, late_arrival_grace_minutes = 15.
-- Downtime: none (single-pass ADD COLUMN ... NOT NULL ... DEFAULT ... is a
--   metadata-only change on PostgreSQL 11+, no full-table rewrite).

-- AlterTable
ALTER TABLE "restaurant_settings" ADD COLUMN "reservation_reminder_minutes_before" INTEGER NOT NULL DEFAULT 60;
ALTER TABLE "restaurant_settings" ADD COLUMN "late_arrival_grace_minutes" INTEGER NOT NULL DEFAULT 15;
