import { Injectable, Inject } from '@nestjs/common';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  StaffReservationsReaderPort,
  STAFF_RESERVATIONS_READER,
} from '../ports/staff-reservations-reader.port';
import { InvalidReservationDateRangeException } from '../../domain/exceptions/invalid-reservation-date-range.exception';
import { ListBranchReservationsCommand } from '../dto/list-branch-reservations.command';
import { BranchReservationsListResult } from '../dto/branch-reservations-list.result';

/**
 * ADR-028's own "max query range" precedent (`ANALYTICS_MAX_RANGE_DAYS`),
 * reused as the same reasonable ceiling here - comfortably covers the
 * largest legitimate calendar view (Month) while still bounding a single
 * query's row count for a very old/very large branch, per this endpoint's
 * own performance requirement (see `BranchReservationsController`'s doc
 * comment). Not a new invented constraint - the same number already governs
 * date-range queries elsewhere in this codebase.
 */
export const BRANCH_RESERVATIONS_MAX_RANGE_DAYS = 366;

const MS_PER_DAY = 86_400_000;

/**
 * Restaurant Dashboard Calendar (`GET
 * /restaurants/:restaurantId/branches/:branchId/reservations`). Employee
 * actor only, branch-scoped - mirrors `assertEmployeeCanActOnReservation`'s
 * exact restaurant/branch comparison (cross-restaurant collapses to
 * `BranchNotFoundException` 404, IDOR-safe; out-of-scope branch is
 * `EmployeeBranchNotAssignedException` 403), but resolved here against the
 * URL's `restaurantId`/`branchId` path params rather than an already-loaded
 * `Reservation` row, since this is a list query with no single target
 * resource. No `PermissionsGuard`/`@RequirePermission` on this route and no
 * new permission slug - TASKS.md (Phase 8, Realtime Rooms §9) is explicit:
 * "Do NOT invent `realtime:*`, `websocket:*`, or `reservations:read`...
 * Existing mutation permissions remain on REST command paths only." A
 * branch-authorized Employee may read the branch's reservation calendar
 * without holding any specific `reservations:*` mutation permission, exactly
 * like the passive branch-room WebSocket precedent that decision describes.
 * `OrganizationMember` has no legitimate claim to a Reservation resource at
 * all (`assertActorCanModifyReservation`'s own documented rule, reused here
 * verbatim) and a `User`/Customer actor is denied outright - both collapse to
 * the same structural `PermissionDeniedException` (403).
 */
@Injectable()
export class ListBranchReservationsUseCase {
  constructor(
    @Inject(STAFF_RESERVATIONS_READER)
    private readonly reader: StaffReservationsReaderPort,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
  ) {}

  async execute(command: ListBranchReservationsCommand): Promise<BranchReservationsListResult> {
    if (command.actor.actorType !== AccessTokenActorType.Employee) {
      throw new PermissionDeniedException();
    }
    if (command.restaurantId !== command.actor.restaurantId) {
      throw new BranchNotFoundException();
    }

    const branch = await this.branchRepository.findByIdAndRestaurantId(
      BranchId.create(command.branchId),
      RestaurantId.create(command.restaurantId),
    );
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    if (command.actor.branchIds.length > 0 && !command.actor.branchIds.includes(command.branchId)) {
      throw new EmployeeBranchNotAssignedException();
    }

    if (command.dateFrom.getTime() > command.dateTo.getTime()) {
      throw new InvalidReservationDateRangeException('"dateFrom" must not be after "dateTo".');
    }
    const spanDays =
      Math.round((command.dateTo.getTime() - command.dateFrom.getTime()) / MS_PER_DAY) + 1;
    if (spanDays > BRANCH_RESERVATIONS_MAX_RANGE_DAYS) {
      throw new InvalidReservationDateRangeException(
        `Requested range spans ${spanDays} days, exceeding the maximum of ${BRANCH_RESERVATIONS_MAX_RANGE_DAYS} days.`,
      );
    }

    const page = await this.reader.search(
      command.restaurantId,
      command.branchId,
      {
        status: command.status,
        dateFrom: command.dateFrom,
        dateTo: command.dateTo,
      },
      command.page,
      command.limit,
    );

    return {
      items: page.items,
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
