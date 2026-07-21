import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * `GALLERY_LIMIT_EXCEEDED` is a new error code, added to API_GUIDELINES.md's
 * documented error-code list this phase (a required doc update for a new
 * endpoint/behavior, not an ADR trigger - CHANGE_POLICY.md's ADR list does
 * not include "new error code"). 409, matching the existing
 * `ORGANIZATION_LIMIT_EXCEEDED` precedent's status code for capacity-limit
 * violations.
 */
export class RestaurantGalleryLimitExceededException extends DomainException {
  public readonly code = 'GALLERY_LIMIT_EXCEEDED';

  constructor(maxImages: number) {
    super(`Restaurant gallery cannot exceed ${maxImages} images.`, 409);
  }
}
