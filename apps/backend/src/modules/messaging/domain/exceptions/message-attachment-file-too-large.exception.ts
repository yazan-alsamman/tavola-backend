import { DomainException } from '@shared/domain/base/domain-exception.base';

export class MessageAttachmentFileTooLargeException extends DomainException {
  public readonly code = 'FILE_TOO_LARGE';

  constructor(maxSizeBytes: number) {
    super(
      `Message attachment file exceeds the maximum allowed size of ${maxSizeBytes} bytes.`,
      413,
    );
  }
}
