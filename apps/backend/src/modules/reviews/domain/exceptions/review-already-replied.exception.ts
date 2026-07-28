import { DomainException } from '@shared/domain/base/domain-exception.base';

/**
 * Thrown both on the pre-check and when the database's own
 * `UNIQUE(reviewId)` constraint on `RestaurantReply` rejects a losing
 * concurrent insert (P2002) - same double-enforcement discipline as
 * `ReviewAlreadyExistsException`.
 */
export class ReviewAlreadyRepliedException extends DomainException {
  public readonly code = 'CONFLICT';

  constructor() {
    super('This review already has a reply.', 409);
  }
}
