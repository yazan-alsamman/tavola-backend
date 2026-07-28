import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Owner decision #15: maximum 5 images per Review. Mirrors
 * `RestaurantGalleryLimitExceededException`'s own precedent (409, matching
 * the `ORGANIZATION_LIMIT_EXCEEDED` capacity-limit convention).
 */
export class ReviewImageLimitExceededException extends DomainException {
  public readonly code = 'REVIEW_IMAGE_LIMIT_EXCEEDED';

  constructor(maxImages: number) {
    super(`A review cannot have more than ${maxImages} active images.`, 409);
  }
}
