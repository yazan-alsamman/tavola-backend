import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Thrown when the file's actual magic-byte signature does not match a
 * supported image format, or does not match the declared Content-Type -
 * mirrors `InvalidReviewImageFileException` exactly (never trust the
 * client-supplied Content-Type header alone).
 */
export class InvalidMessageAttachmentFileException extends DomainException {
  public readonly code = 'INVALID_FILE';

  constructor() {
    super('The uploaded file is not a valid image of a supported type.', 400);
  }
}
