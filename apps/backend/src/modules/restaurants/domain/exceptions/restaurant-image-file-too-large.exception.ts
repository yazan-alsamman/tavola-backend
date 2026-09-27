import { DomainException } from '@shared/domain/base/domain-exception.base';

export class RestaurantImageFileTooLargeException extends DomainException {
  public readonly code = 'FILE_TOO_LARGE';

  constructor(maxSizeBytes: number) {
    super(`Restaurant image file exceeds the maximum allowed size of ${maxSizeBytes} bytes.`, 413);
  }
}
