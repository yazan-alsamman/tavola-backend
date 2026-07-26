import { Entity } from '@shared/domain/base/entity.base';
import { BranchId, FloorPlanId, TableId } from '@shared/domain/value-objects/identifiers.vo';
import { TableShape, TableStatus } from '../enums/table.enums';
import { InvalidTableException } from '../exceptions/invalid-table.exception';
import { InvalidTableStatusTransitionException } from '../exceptions/invalid-table-status-transition.exception';
import { TableMergeConflictException } from '../exceptions/table-merge-conflict.exception';
import { TableNotMergedException } from '../exceptions/table-not-merged.exception';

export interface TableProps {
  id: string;
  branchId: string;
  floorPlanId: string;
  tableNumber: string;
  capacity: number;
  floor: number | null;
  positionX: number | null;
  positionY: number | null;
  width: number | null;
  height: number | null;
  rotation: number | null;
  shape: TableShape;
  layer: number | null;
  indoor: boolean;
  vip: boolean;
  smoking: boolean;
  status: TableStatus;
  mergeGroupId: string | null;
  isMergePrimary: boolean;
  createdAt: Date;
  updatedAt: Date;
  deletedAt: Date | null;
}

/**
 * Table Module. Every Table belongs to exactly one FloorPlan (`floorPlanId`
 * required, never nullable - TASKS.md Phase 6.1 decision #2). `Create Table`
 * always produces `status = TableStatus.Available`; further transitions go
 * exclusively through `transitionStatus` (Status Management architecture
 * decision), never through `updateProfile`.
 *
 * `mergeGroupId`/`isMergePrimary` (Phase 6 — Merge/Split Tables, ADR-026,
 * architecture frozen 2026-07-25) are set exclusively by `asMergePrimary`/
 * `asMergeSecondary`, and cleared exclusively by `clearMergeMembership` -
 * `updateProfile` never touches either. `Create Table` always produces
 * `mergeGroupId = null`/`isMergePrimary = false` (enforced here in `create`,
 * not merely by caller convention).
 */
export class Table extends Entity<TableProps> {
  private constructor(props: TableProps) {
    super(props);
  }

  static create(props: TableProps): Table {
    validate(props);
    return new Table({ ...props, mergeGroupId: null, isMergePrimary: false });
  }

  static reconstitute(props: TableProps): Table {
    return new Table({ ...props });
  }

  get tableId(): TableId {
    return TableId.create(this.props.id);
  }

  get branchId(): BranchId {
    return BranchId.create(this.props.branchId);
  }

  get floorPlanId(): FloorPlanId {
    return FloorPlanId.create(this.props.floorPlanId);
  }

  get tableNumber(): string {
    return this.props.tableNumber;
  }

  get capacity(): number {
    return this.props.capacity;
  }

  get floor(): number | null {
    return this.props.floor;
  }

  get positionX(): number | null {
    return this.props.positionX;
  }

  get positionY(): number | null {
    return this.props.positionY;
  }

  get width(): number | null {
    return this.props.width;
  }

  get height(): number | null {
    return this.props.height;
  }

  get rotation(): number | null {
    return this.props.rotation;
  }

  get shape(): TableShape {
    return this.props.shape;
  }

  get layer(): number | null {
    return this.props.layer;
  }

  get indoor(): boolean {
    return this.props.indoor;
  }

  get vip(): boolean {
    return this.props.vip;
  }

  get smoking(): boolean {
    return this.props.smoking;
  }

  get status(): TableStatus {
    return this.props.status;
  }

  get mergeGroupId(): string | null {
    return this.props.mergeGroupId;
  }

  get isMergePrimary(): boolean {
    return this.props.isMergePrimary;
  }

  /**
   * Phase 6 (Merge/Split Tables, ADR-026) - `true` for both the primary and
   * every secondary of an active merge group.
   */
  get isInMergeGroup(): boolean {
    return this.props.mergeGroupId !== null;
  }

  get createdAt(): Date {
    return new Date(this.props.createdAt.getTime());
  }

  get updatedAt(): Date {
    return new Date(this.props.updatedAt.getTime());
  }

  get deletedAt(): Date | null {
    return this.props.deletedAt ? new Date(this.props.deletedAt.getTime()) : null;
  }

  isSoftDeleted(): boolean {
    return this.props.deletedAt !== null;
  }

  /**
   * Full-replace profile fields only - never `branchId`/`floorPlanId`
   * (changing `floorPlanId` is exclusively `moveToFloorPlan`'s
   * responsibility, Phase 6.2 - Update Table and Move Table are deliberately
   * separate Domain Actions), `status` (changing `status` is exclusively
   * `transitionStatus`'s responsibility - Status Management architecture
   * decision), or `mergeGroupId`/`isMergePrimary` (exclusively
   * `asMergePrimary`/`asMergeSecondary`/`clearMergeMembership`'s
   * responsibility - Phase 6 Merge/Split, ADR-026).
   */
  updateProfile(
    props: {
      tableNumber: string;
      capacity: number;
      floor: number | null;
      positionX: number | null;
      positionY: number | null;
      width: number | null;
      height: number | null;
      rotation: number | null;
      shape: TableShape;
      layer: number | null;
      indoor: boolean;
      vip: boolean;
      smoking: boolean;
    },
    at: Date,
  ): Table {
    validate({ ...this.props, ...props });
    return Table.reconstitute({
      ...this.props,
      tableNumber: props.tableNumber,
      capacity: props.capacity,
      floor: props.floor,
      positionX: props.positionX,
      positionY: props.positionY,
      width: props.width,
      height: props.height,
      rotation: props.rotation,
      shape: props.shape,
      layer: props.layer,
      indoor: props.indoor,
      vip: props.vip,
      smoking: props.smoking,
      updatedAt: at,
    });
  }

  softDelete(at: Date): Table {
    return Table.reconstitute({
      ...this.props,
      deletedAt: at,
      updatedAt: at,
    });
  }

  /**
   * Move Table (Phase 6.2 architecture decision, TASKS.md) - a dedicated
   * Domain Action, not a partial update. Changes ONLY `floorPlanId`; nothing
   * else (`branchId`, `tableNumber`, `capacity`, `shape`,
   * position/rotation/dimensions, `status`, `mergeGroupId` are all
   * untouched). The caller (`MoveTableUseCase`) is responsible for verifying
   * the target FloorPlan exists, belongs to this Table's own branch, and is
   * not soft-deleted before calling this method.
   *
   * Phase 6 (Merge/Split Tables, ADR-026 decision #11/#13) - a table
   * currently part of an active merge group can never be moved; Split
   * first. `MoveTableUseCase` already rejects this case earlier with a
   * dedicated `TableMergedOperationForbiddenException` for a clearer error;
   * this guard is the entity-level invariant of last resort.
   */
  moveToFloorPlan(floorPlanId: string, at: Date): Table {
    if (this.props.mergeGroupId !== null) {
      throw new InvalidTableException(
        'Cannot move a table that is part of an active merge group - split it first.',
      );
    }
    return Table.reconstitute({
      ...this.props,
      floorPlanId,
      updatedAt: at,
    });
  }

  /**
   * Status Management architecture decision (TASKS.md "Phase 6 — Status
   * Management" note) - a dedicated Domain Action, not a partial update.
   * Changes ONLY `status`; nothing else. The state machine is restrictive by
   * design: the only allowed transitions are `Available -> Occupied`,
   * `Available -> Cleaning`, `Available -> Disabled`, and each of those
   * reversed back to `Available`. Every other combination - including a
   * same-status "transition" and any direct swap between `Occupied`,
   * `Cleaning`, and `Disabled` - is rejected. There are no implicit
   * transitions.
   *
   * Phase 6 (Merge/Split Tables, ADR-026 decision #11/#13) - a table
   * currently part of an active merge group can never transition status
   * through this method (whether primary or secondary); Split first.
   * `ChangeTableStatusUseCase` already rejects this case earlier with a
   * dedicated `TableMergedOperationForbiddenException` for a clearer error;
   * this guard is the entity-level invariant of last resort. `Merged` itself
   * is also rejected as either the current or target status by
   * `validateTransition`, exactly like `Reserved` - it is never reachable
   * through this method regardless of `mergeGroupId`.
   */
  transitionStatus(target: TableStatus, at: Date): Table {
    if (this.props.mergeGroupId !== null) {
      throw new InvalidTableStatusTransitionException(
        'Cannot change the status of a table that is part of an active merge group - split it first.',
      );
    }
    validateTransition(this.props.status, target);
    return Table.reconstitute({
      ...this.props,
      status: target,
      updatedAt: at,
    });
  }

  /**
   * Phase 6 (Merge/Split Tables, ADR-026 decision #1/#9) - marks this Table
   * as the Primary of a new merge group `mergeGroupId`. The primary keeps
   * `TableStatus.Available` (it remains the reservable unit for the whole
   * group via the existing `reserve()`/`release()` methods) - only
   * `mergeGroupId`/`isMergePrimary` change. Requires the table to currently
   * be `Available` and not already part of a merge group; the caller
   * (`MergeTablesUseCase`) is responsible for every cross-table Merge rule
   * (`TableMergeService.assertMergeable`) - this method only enforces its
   * own single-entity invariant.
   */
  asMergePrimary(mergeGroupId: string, at: Date): Table {
    if (this.props.mergeGroupId !== null) {
      throw new TableMergeConflictException(
        `Table "${this.props.id}" is already part of a merge group - split it first.`,
      );
    }
    if (this.props.status !== TableStatus.Available) {
      throw new TableMergeConflictException(
        `Table "${this.props.id}" is not Available (current status: "${this.props.status}") - only Available tables can be merged.`,
      );
    }
    return Table.reconstitute({
      ...this.props,
      mergeGroupId,
      isMergePrimary: true,
      status: TableStatus.Available,
      updatedAt: at,
    });
  }

  /**
   * Phase 6 (Merge/Split Tables, ADR-026 decision #1/#3) - marks this Table
   * as a Secondary of merge group `mergeGroupId`: not independently
   * reservable while merged, so its status becomes `TableStatus.Merged`.
   * Same single-entity preconditions as `asMergePrimary` (currently
   * `Available`, not already merged).
   */
  asMergeSecondary(mergeGroupId: string, at: Date): Table {
    if (this.props.mergeGroupId !== null) {
      throw new TableMergeConflictException(
        `Table "${this.props.id}" is already part of a merge group - split it first.`,
      );
    }
    if (this.props.status !== TableStatus.Available) {
      throw new TableMergeConflictException(
        `Table "${this.props.id}" is not Available (current status: "${this.props.status}") - only Available tables can be merged.`,
      );
    }
    return Table.reconstitute({
      ...this.props,
      mergeGroupId,
      isMergePrimary: false,
      status: TableStatus.Merged,
      updatedAt: at,
    });
  }

  /**
   * Phase 6 (Merge/Split Tables, ADR-026 decision #2) - the Split
   * counterpart of `asMergePrimary`/`asMergeSecondary`: clears
   * `mergeGroupId`/`isMergePrimary` unconditionally, restoring independent
   * reservability. A former secondary (`status === Merged`) becomes
   * `Available` again; a former primary (`status` already `Available` or
   * `Reserved` - an Approved reservation against the merged unit still
   * targets it) keeps its current status unchanged. No new Table rows are
   * created or destroyed, and permanent `capacity` is never touched -
   * "Split = undo merge only."
   */
  clearMergeMembership(at: Date): Table {
    if (this.props.mergeGroupId === null) {
      throw new TableNotMergedException();
    }
    return Table.reconstitute({
      ...this.props,
      mergeGroupId: null,
      isMergePrimary: false,
      status: this.props.status === TableStatus.Merged ? TableStatus.Available : this.props.status,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.2 (Approval Workflow, architecture frozen 2026-07-20) - a narrow
   * domain operation, separate from `transitionStatus`. Called only by the
   * Reservation write path: at manual Approval, or at creation time for
   * auto-approval (TASKS.md Phase 7 decision note item 6). Requires the
   * table to currently be `Available` - a table already `Occupied`/
   * `Cleaning`/`Disabled` cannot be reserved (DOMAIN_MODEL.md's existing
   * "Disabled tables cannot receive reservations"/"Tables under cleaning
   * cannot be reserved" rules). `reservationId` is accepted for signature
   * parity with the frozen `Table.reserve(reservationId, at)` decision text;
   * no `Table` column persists it (DATABASE_SCHEMA.md documents no such
   * column).
   */
  reserve(reservationId: string, at: Date): Table {
    if (this.props.status !== TableStatus.Available) {
      throw new InvalidTableStatusTransitionException(
        `Cannot reserve table from status "${this.props.status}" - only an Available table may be reserved (reservationId: ${reservationId}).`,
      );
    }
    return Table.reconstitute({
      ...this.props,
      status: TableStatus.Reserved,
      updatedAt: at,
    });
  }

  /**
   * Phase 7.2 (Approval Workflow) - the narrow counterpart to `reserve()`.
   * Requires the table to currently be `Reserved`. Not called by Reject or
   * automatic rejection of overlapping Pending reservations (TASKS.md's
   * "Phase 7.2 — Approval Workflow: Architecture Correction" - a `Pending`
   * reservation never reserved the table, so there is nothing to release).
   */
  release(at: Date): Table {
    if (this.props.status !== TableStatus.Reserved) {
      throw new InvalidTableStatusTransitionException(
        `Cannot release table from status "${this.props.status}" - only a Reserved table may be released.`,
      );
    }
    return Table.reconstitute({
      ...this.props,
      status: TableStatus.Available,
      updatedAt: at,
    });
  }

  toProps(): Readonly<TableProps> {
    return { ...this.props };
  }
}

function validate(props: TableProps): void {
  if (!props.tableNumber || props.tableNumber.trim().length === 0) {
    throw new InvalidTableException('tableNumber must not be empty.');
  }
  if (!Number.isInteger(props.capacity) || props.capacity <= 0) {
    throw new InvalidTableException('capacity must be a positive integer.');
  }
}

/**
 * `Reserved` and `Merged` are deliberately excluded from this state machine
 * in both directions (Phase 7.2 architecture freeze; Phase 6 Merge/Split,
 * ADR-026) - `Table.transitionStatus`/`POST /tables/{tableId}/status` must
 * never be able to set or clear either, even though `current === Available`
 * would otherwise satisfy the general rule below. Only `Table.reserve()`/
 * `Table.release()` may touch `Reserved`; only `Table.asMergeSecondary()`/
 * `Table.clearMergeMembership()` may touch `Merged`.
 */
function validateTransition(current: TableStatus, target: TableStatus): void {
  const touchesReservedOrMerged =
    current === TableStatus.Reserved ||
    target === TableStatus.Reserved ||
    current === TableStatus.Merged ||
    target === TableStatus.Merged;
  const isValid =
    !touchesReservedOrMerged &&
    current !== target &&
    (current === TableStatus.Available || target === TableStatus.Available);
  if (!isValid) {
    throw new InvalidTableStatusTransitionException(
      `Cannot transition table status from "${current}" to "${target}" - only Available <-> Occupied, Available <-> Cleaning, and Available <-> Disabled are allowed.`,
    );
  }
}
