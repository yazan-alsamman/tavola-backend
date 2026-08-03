import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MenuImageFileTooLargeException extends DomainException {
  public readonly code = 'VALIDATION_ERROR';

  constructor(maxSizeBytes: number) {
    super(`Image file exceeds the maximum size of ${maxSizeBytes} bytes.`, 400);
  }
}
