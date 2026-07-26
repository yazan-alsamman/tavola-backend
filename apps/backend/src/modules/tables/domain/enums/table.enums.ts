/**
 * Status Management architecture decision (TASKS.md "Phase 6 — Status
 * Management" note): `Create Table` always produces `Available`. Manual
 * transitions happen exclusively through the single dedicated Domain Action
 * `POST /tables/{tableId}/status` (`ChangeTableStatusUseCase`), restricted to
 * `Available <-> Occupied`/`Available <-> Cleaning`/`Available <-> Disabled`
 * only - every other combination, including a same-status "transition", is
 * rejected by `Table.transitionStatus`. `Update Table` never transitions
 * status.
 *
 * `Reserved` (Phase 7.2 — Approval Workflow, architecture frozen 2026-07-20)
 * is exclusively a Reservation Engine concept: only `Table.reserve()`/
 * `Table.release()` may set or clear it. `Table.transitionStatus` continues
 * to reject `Reserved` as either the current or target status - it is never
 * reachable through `POST /tables/{tableId}/status`.
 *
 * `Merged` (Phase 6 — Merge/Split Tables, architecture frozen 2026-07-25,
 * ADR-026) is exclusively a Merge/Split concept, set only on a merge
 * *secondary*: only `Table.asMergeSecondary()`/`Table.clearMergeMembership()`
 * may set or clear it. A merge *primary* keeps using `Available`/`Reserved`
 * via the existing `reserve()`/`release()` methods - `Merged` is never set on
 * a primary. `Table.transitionStatus` rejects `Merged` as either the current
 * or target status, exactly like `Reserved` - it is never reachable through
 * `POST /tables/{tableId}/status`.
 */
export enum TableStatus {
  Available = 'Available',
  Occupied = 'Occupied',
  Cleaning = 'Cleaning',
  Disabled = 'Disabled',
  Reserved = 'Reserved',
  Merged = 'Merged',
}

/**
 * Phase 6.1 architecture decision (TASKS.md Phase 6.1 decision #7):
 * presentation metadata only - describes floor-plan rendering, no bearing on
 * reservation rules, capacity, or merge/split behavior. Intentionally
 * minimal: a square table is represented as `Rectangle` with `width ==
 * height`, not a separate `Square` value.
 */
export enum TableShape {
  Rectangle = 'Rectangle',
  Round = 'Round',
}
