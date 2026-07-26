import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #11/#13). Move Table
 * (`POST /tables/:tableId/move`) and Status Management
 * (`POST /tables/:tableId/status`) both reject any table currently part of
 * an active merge group (`mergeGroupId !== null`) - Split first. Thrown by
 * `MoveTableUseCase`/`ChangeTableStatusUseCase` BEFORE calling the entity's
 * own mutation method, so the rejection carries a clear, Merge/Split-specific
 * message rather than the entity's own generic transition-guard error.
 */
export class TableMergedOperationForbiddenException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(operation: 'move' | 'status') {
    super(
      `Cannot ${operation === 'move' ? 'move' : 'change the status of'} a table that is part of an active merge group - split it first.`,
      400,
    );
  }
}
