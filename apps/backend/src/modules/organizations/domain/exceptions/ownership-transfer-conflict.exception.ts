import { DomainException } from '@shared/domain/base/domain-exception.base';

/** ADR-034 §6 - target member is not eligible to receive ownership (already owner, not Active, or a different Organization). */
export class OwnershipTransferConflictException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor(message: string) {
    super(message, 409);
  }
}
