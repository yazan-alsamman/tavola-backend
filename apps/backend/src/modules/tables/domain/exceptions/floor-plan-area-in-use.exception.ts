import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * ADR-040 decision #7 - mirrors the FloorPlan deletion guard documented in
 * DATABASE_SCHEMA.md ("a FloorPlan cannot be deleted while any Table still
 * references it"): tables are never silently reassigned or orphaned, so the
 * caller must move or delete them first.
 */
export class FloorPlanAreaInUseException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(tableCount: number) {
    super(
      `Floor plan area still has ${tableCount} table(s) assigned - reassign or delete them before deleting the area.`,
      409,
    );
  }
}
