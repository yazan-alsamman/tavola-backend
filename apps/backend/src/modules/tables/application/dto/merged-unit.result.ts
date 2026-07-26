import { TableResult } from './table.result';

/**
 * Phase 6 (Merge/Split Tables, ADR-026) - the result shape shared by
 * `MergeTablesUseCase`/`SplitTablesUseCase`'s own return values need not
 * match exactly, but both describe "the merge group as it now stands" (Merge:
 * freshly created; Split: freshly dissolved, snapshotted immediately before
 * clearing). `effectiveCapacity` is `TableMergeService.computeEffectiveCapacity`
 * over `members` at the moment of the operation.
 */
export interface MergedUnitResult {
  mergeGroupId: string;
  primaryTableId: string;
  memberTableIds: string[];
  effectiveCapacity: number;
  primary: TableResult;
  members: TableResult[];
}
