import { DomainException } from '@shared/domain/base/domain-exception.base';

export class AvatarFileTooLargeException extends DomainException {
  public readonly code = 'FILE_TOO_LARGE';

  constructor(maxSizeBytes: number) {
    super(`Avatar file exceeds the maximum allowed size of ${maxSizeBytes} bytes.`, 413);
  }
}
