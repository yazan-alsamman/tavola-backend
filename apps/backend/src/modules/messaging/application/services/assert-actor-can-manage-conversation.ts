import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { MessageSenderType } from '../../domain/enums/messaging.enums';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';

/** DECISIONS.md D15 - no existing permission slug fits, unlike Analytics' reuse of `reports:view`. */
export const CONVERSATIONS_MANAGE_PERMISSION = 'conversations:manage';

/**
 * DECISIONS.md D15 (Dual Actor authorization) - shared by every staff-facing
 * Messaging use case. Mirrors `assertActorCanManageTables`/ADR-026's shape
 * exactly: only `JwtAuthGuard` + `SessionVersionGuard` on the route, no
 * NestJS OR-composed guard - actor-type branching happens here, inside the
 * use case.
 *
 * `organizationId` must already be resolved by the caller from the
 * conversation's own `restaurantId -> Restaurant.organizationId` chain
 * (ADR-030) - for an `Employee` actor this is a direct string comparison
 * against `actor.restaurantId`/`actor.organizationId` (both JWT-embedded,
 * no repository round-trip needed, mirroring
 * `assertEmployeeCanActOnReservation`); for an `OrganizationMember` actor the
 * caller must resolve the parent `Restaurant` via the already-tenant-scoped
 * `RestaurantRepository` first (mirroring `assertActorCanManageTables`'s own
 * documented precondition).
 *
 * `branchId: null` means the conversation is restaurant-wide (no specific
 * Branch) - an Employee's branch-assignment restriction is skipped in that
 * case (there is no branch to be out-of-scope for); a `Customer` (`User`)
 * actor has no legitimate claim to the Restaurant side at all and is denied
 * outright, same as `assertActorCanManageTables`.
 *
 * Cross-organization actors collapse to `ConversationNotFoundException`
 * (404, D14) rather than a 403 - IDOR-safe. A same-organization actor
 * lacking the required role/permission/branch scope gets the more specific
 * 403.
 */
export function assertActorCanManageConversation(
  actor: AuthenticatedActor,
  organizationId: string,
  branchId: BranchId | null,
): void {
  if (actor.actorType === AccessTokenActorType.OrganizationMember) {
    if (actor.organizationId !== organizationId) {
      throw new ConversationNotFoundException();
    }
    if (
      actor.orgRole !== OrganizationMemberRole.Owner &&
      actor.orgRole !== OrganizationMemberRole.Admin
    ) {
      throw new PermissionDeniedException();
    }
    return;
  }

  if (actor.actorType === AccessTokenActorType.Employee) {
    if (actor.organizationId !== organizationId) {
      throw new ConversationNotFoundException();
    }
    if (
      branchId !== null &&
      actor.branchIds.length > 0 &&
      !actor.branchIds.includes(branchId.value)
    ) {
      throw new EmployeeBranchNotAssignedException();
    }
    if (!actor.permissions.includes(CONVERSATIONS_MANAGE_PERMISSION)) {
      throw new PermissionDeniedException(CONVERSATIONS_MANAGE_PERMISSION);
    }
    return;
  }

  throw new PermissionDeniedException();
}

/**
 * DECISIONS.md D3/D15 - the id to attribute `Message.senderEmployeeId`/
 * `senderUserId` and audit rows to. Only ever called after
 * `assertActorCanManageConversation` has already confirmed the actor is one
 * of these two types, mirroring `resolveTableManagementActorId`.
 */
export function resolveMessagingActorId(actor: AuthenticatedActor): string {
  return actor.actorType === AccessTokenActorType.Employee ? actor.employeeId : actor.userId;
}

/**
 * DECISIONS.md D3 - the `(senderType, senderUserId, senderEmployeeId)` triple
 * for a `Message` authored by the current actor. Only ever called after
 * `assertActorCanManageConversation` (Restaurant side) or a Customer
 * ownership check (Customer side) has already authorized the actor.
 */
export function resolveMessageSender(actor: AuthenticatedActor): {
  senderType: MessageSenderType;
  senderUserId: string | null;
  senderEmployeeId: string | null;
} {
  if (actor.actorType === AccessTokenActorType.Employee) {
    return {
      senderType: MessageSenderType.Employee,
      senderUserId: null,
      senderEmployeeId: actor.employeeId,
    };
  }
  if (actor.actorType === AccessTokenActorType.OrganizationMember) {
    return {
      senderType: MessageSenderType.OrganizationMember,
      senderUserId: actor.userId,
      senderEmployeeId: null,
    };
  }
  return {
    senderType: MessageSenderType.Customer,
    senderUserId: actor.userId,
    senderEmployeeId: null,
  };
}
