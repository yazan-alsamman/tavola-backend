import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Phase 6 (Merge/Split Tables, ADR-026). Thrown by `SplitTablesUseCase` when
 * the target table's `mergeGroupId` is `null` - there is no active merge
 * group to undo. A conflict (the table exists and the request is otherwise
 * well-formed, but its current state has nothing to split), not a plain
 * validation failure.
 */
export class TableNotMergedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('Table is not part of a merge group.', 409);
  }
}
