import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface BranchWorkingHoursEntryInput {
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

/** Full-replace semantics, matching `UpdateWorkingHoursCommand`'s established
 * convention: the given `entries` become the branch's entire week - a day
 * not present in `entries` has no override for that branch. */
export interface UpdateBranchWorkingHoursCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
  entries: BranchWorkingHoursEntryInput[];
  correlationId?: string;
}
