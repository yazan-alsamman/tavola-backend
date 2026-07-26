import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { OrganizationMemberRole } from '@modules/organizations/domain/enums/organization.enums';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { BranchId } from '@shared/domain/value-objects/identifiers.vo';
import { TableNotFoundException } from '../../domain/exceptions/table-not-found.exception';

/**
 * ADR-026 decision #12: no new permission slug - reuses the existing
 * `tables:manage` slug already exercised by
 * `apps/backend/src/modules/authorization/domain/authorization.domain.spec.ts`.
 */
export const TABLES_MANAGE_PERMISSION = 'tables:manage';

/**
 * Phase 6 (Merge/Split Tables, ADR-026 decision #12) - shared by
 * `MergeTablesUseCase`/`SplitTablesUseCase`. Both routes use only
 * `JwtAuthGuard` + `SessionVersionGuard` (no `OrganizationMemberGuard`/
 * `PermissionsGuard`, which would otherwise structurally deny one of the two
 * legitimate actor types) - authorization is resolved entirely here,
 * use-case-branching, exactly like `assertActorCanModifyReservation`'s own
 * Phase 7.3 precedent.
 *
 * An `OrganizationMember` must belong to `organizationId` (already resolved
 * by the caller from the target table(s)' own Branch -> Restaurant ->
 * Organization chain) and hold `Owner`/`Admin` role. An `Employee` must
 * belong to the same organization, pass branch scope against `branchId`
 * (empty `branchIds` = restaurant-wide scope, matching
 * `assertActorCanModifyReservation`'s own semantics), and hold
 * `tables:manage`. Any other actor type (`User`) has no legitimate claim to
 * this Domain Action at all and is denied outright.
 *
 * A cross-organization `OrganizationMember`/`Employee` collapses to
 * `TableNotFoundException` (404) rather than a 403 - IDOR-safe, matching
 * every other module's own "unknown/cross-tenant collapse to the same
 * response" precedent (see `assertActorCanModifyReservation`'s own comment).
 * A same-organization actor lacking the required role/permission/branch
 * scope gets the more specific 403 - the resource's existence is already
 * legitimately visible to them at the organization level.
 */
export function assertActorCanManageTables(
  actor: AuthenticatedActor,
  organizationId: string,
  branchId: BranchId,
): void {
  if (actor.actorType === AccessTokenActorType.OrganizationMember) {
    if (actor.organizationId !== organizationId) {
      throw new TableNotFoundException();
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
      throw new TableNotFoundException();
    }
    if (actor.branchIds.length > 0 && !actor.branchIds.includes(branchId.value)) {
      throw new EmployeeBranchNotAssignedException();
    }
    if (!actor.permissions.includes(TABLES_MANAGE_PERMISSION)) {
      throw new PermissionDeniedException(TABLES_MANAGE_PERMISSION);
    }
    return;
  }

  throw new PermissionDeniedException();
}

/**
 * ADR-026 decision #16: the id to attribute `TableMerged`/`TableSplit` (and
 * their audit rows) to - the Employee's own id for an Employee actor, the
 * OrganizationMember's own `userId` otherwise (existing `TableMoved`/
 * `TableStatusChanged` convention). Only ever called after
 * `assertActorCanManageTables` has already confirmed the actor is one of
 * these two types.
 */
export function resolveTableManagementActorId(actor: AuthenticatedActor): string {
  return actor.actorType === AccessTokenActorType.Employee ? actor.employeeId : actor.userId;
}
