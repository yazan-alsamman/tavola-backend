import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';

/**
 * `DELETE /reviews/:id` (ADR-045, CR WJ-R-2026-002): only the guest who
 * wrote the review may delete it. The restaurant - Owner, Admin or
 * Employee - never deletes a review under any circumstance; it replies, or
 * opens the review for re-rating. Reviews are public, so refusing a
 * restaurant actor with 403 reveals nothing.
 */
export function assertActorCanDeleteReview(actor: AuthenticatedActor, review: Review): void {
  if (actor.actorType === AccessTokenActorType.User) {
    if (actor.userId === review.userId.value) {
      return;
    }
    throw new ReviewNotFoundException();
  }
  throw new PermissionDeniedException();
}
