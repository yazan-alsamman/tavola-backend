-- Phase 7.2 (Approval Workflow, architecture frozen 2026-07-20): adds
-- TableStatus.Reserved, exclusively set/cleared by the new Table.reserve()/
-- Table.release() domain methods (never through Table.transitionStatus /
-- POST /tables/{tableId}/status, which continue to reject it - see the Table
-- entity's own transitionStatus guard). Purely additive; no other schema
-- change is required by this phase (Reservation already carries
-- approvedBy/approvedAt/notes from the Phase 7.1 migration).
ALTER TYPE "TableStatus" ADD VALUE 'Reserved';
