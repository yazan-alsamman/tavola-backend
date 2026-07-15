import { DomainException } from '@shared/domain/base/domain-exception.base';

export class PermissionDeniedException extends DomainException {
  public readonly code = 'FORBIDDEN';

  constructor(permission?: string) {
    super(
      permission
        ? `Permission denied: ${permission}.`
        : 'You do not have permission to perform this action.',
      403,
    );
  }
}
