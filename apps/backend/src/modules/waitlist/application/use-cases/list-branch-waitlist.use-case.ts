import { Injectable, Inject } from '@nestjs/common';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import { EmployeeBranchNotAssignedException } from '@modules/authorization/domain/exceptions/employee-branch-not-assigned.exception';
import { BranchNotFoundException } from '@modules/branches/domain/exceptions/branch-not-found.exception';
import {
  BranchRepository,
  BRANCH_REPOSITORY,
} from '@modules/branches/domain/repositories/branch.repository';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { WaitlistStatus } from '../../domain/enums/waitlist.enums';
import {
  StaffWaitlistItem,
  StaffWaitlistReaderPort,
  STAFF_WAITLIST_READER,
} from '../ports/staff-waitlist-reader.port';
import { assertOrganizationAdminOwnsRestaurant } from '../services/assert-actor-can-modify-waitlist-entry';

export interface ListBranchWaitlistCommand {
  actor: AuthenticatedActor;
  restaurantId: string;
  branchId: string;
  /** The queue day (UTC midnight of the branch-local calendar date). */
  preferredDate: Date;
  status?: WaitlistStatus;
}

const WAITLIST_PERMISSION = 'reservations:waitlist';

/**
 * One branch's waitlist for one day, for the Restaurant Dashboard. Same
 * actor rules as the other staff waitlist actions: the organization
 * Owner/Admin, or an Employee holding reservations:waitlist within branch
 * scope. A branch outside the caller's restaurant collapses to 404.
 */
@Injectable()
export class ListBranchWaitlistUseCase {
  constructor(
    @Inject(STAFF_WAITLIST_READER) private readonly reader: StaffWaitlistReaderPort,
    @Inject(BRANCH_REPOSITORY) private readonly branchRepository: BranchRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
  ) {}

  async execute(command: ListBranchWaitlistCommand): Promise<StaffWaitlistItem[]> {
    const { actor } = command;
    if (actor.actorType === AccessTokenActorType.OrganizationMember) {
      await assertOrganizationAdminOwnsRestaurant(
        actor,
        RestaurantId.create(command.restaurantId),
        WAITLIST_PERMISSION,
        this.restaurantRepository,
        () => new BranchNotFoundException(),
      );
    } else if (actor.actorType === AccessTokenActorType.Employee) {
      if (command.restaurantId !== actor.restaurantId) {
        throw new BranchNotFoundException();
      }
      if (actor.branchIds.length > 0 && !actor.branchIds.includes(command.branchId)) {
        throw new EmployeeBranchNotAssignedException();
      }
      if (!actor.permissions.includes(WAITLIST_PERMISSION)) {
        throw new PermissionDeniedException(WAITLIST_PERMISSION);
      }
    } else {
      throw new PermissionDeniedException(WAITLIST_PERMISSION);
    }

    const branch = await this.branchRepository.findByIdAndRestaurantId(
      BranchId.create(command.branchId),
      RestaurantId.create(command.restaurantId),
    );
    if (branch === null) {
      throw new BranchNotFoundException();
    }

    return this.reader.listForBranchDay(command.restaurantId, command.branchId, {
      preferredDate: command.preferredDate,
      status: command.status,
    });
  }
}
