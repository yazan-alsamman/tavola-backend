/**
 * Status Management architecture decision (TASKS.md "Phase 6 — Status
 * Management" note): four values only. `Create Table` always produces
 * `Available`. Transitions happen exclusively through the single dedicated
 * Domain Action `POST /tables/{tableId}/status` (`ChangeTableStatusUseCase`),
 * restricted to `Available <-> Occupied`/`Available <-> Cleaning`/
 * `Available <-> Disabled` only - every other combination, including a
 * same-status "transition", is rejected by `Table.transitionStatus`. `Update
 * Table` never transitions status. `Reserved` is deliberately excluded - it
 * is exclusively a Reservation Engine concept, to be introduced only after
 * the Reservation Engine architecture has been approved and frozen, through
 * its own explicit architectural decision. `Merged` is deliberately excluded
 * - it belongs to the deferred Merge/Split feature.
 */
export enum TableStatus {
  Available = 'Available',
  Occupied = 'Occupied',
  Cleaning = 'Cleaning',
  Disabled = 'Disabled',
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
