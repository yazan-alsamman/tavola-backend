import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decisions #8/#9):
 * `DELETE /reviews/:id` is reachable by either the owning Customer
 * (ownership, no RBAC) or an Organization Owner/Admin of the Restaurant the
 * Review belongs to - one route, no NestJS OR-guard composition, resolved
 * here inside the use case, exactly like `assertActorCanManageTables`'s own
 * Merge/Split precedent and Phase 7.3's Cancel/Reschedule dual-actor
 * pattern. Employees may not delete Reviews in Phase 10 - categorically
 * denied, no exception.
 *
 * `restaurantOrganizationId` must be resolved by the caller via the already
 * tenant-scoped `RestaurantRepository.findById(review.restaurantId)` -
 * `null` there (cross-tenant, or a genuinely deleted Restaurant) must
 * already have collapsed to `ReviewNotFoundException` before this function
 * is ever called for an `OrganizationMember` actor; pass an empty string for
 * a `User` actor, where it is never read.
 */
export function assertActorCanDeleteReview(
  actor: AuthenticatedActor,
  review: Review,
  restaurantOrganizationId: string,
): void {
  if (actor.actorType === AccessTokenActorType.User) {
    if (actor.userId === review.userId.value) {
      return;
    }
    throw new ReviewNotFoundException();
  }

  if (actor.actorType === AccessTokenActorType.OrganizationMember) {
    if (actor.organizationId !== restaurantOrganizationId) {
      throw new ReviewNotFoundException();
    }
    if (
      actor.orgRole !== OrganizationMemberRole.Owner &&
      actor.orgRole !== OrganizationMemberRole.Admin
    ) {
      throw new PermissionDeniedException();
    }
    return;
  }

  // Employee (or any other actor type): no legitimate claim to this Domain
  // Action at all, mirroring `assertActorCanManageTables`'s own "denied
  // outright" precedent for a categorically wrong actor type.
  throw new PermissionDeniedException();
}
