import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * API_GUIDELINES.md's Bulk Reorder Endpoints convention: the submitted
 * `orderedIds` array must exactly match the current non-deleted sibling set
 * under the resolved parent (set equality, both directions) - a partial
 * array, a foreign id, or an id belonging to a different parent is rejected
 * before any `displayOrder` value is written.
 */
export class MenuReorderSetMismatchException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor() {
    super('orderedIds must exactly match the current non-deleted sibling set.', 400);
  }
}
