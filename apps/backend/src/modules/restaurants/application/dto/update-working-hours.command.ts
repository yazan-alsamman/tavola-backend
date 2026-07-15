import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface WorkingHoursEntryInput {
  dayOfWeek: number;
  openingTime: string;
  closingTime: string;
  breakStartTime: string | null;
  breakEndTime: string | null;
}

/** Full-replace semantics, matching every other update command in this
 * module: the given `entries` become the restaurant's entire week - a day
 * not present in `entries` is closed that day. Restaurant-level only
 * (Phase 4.3 scope); no `branchId`. */
export interface UpdateWorkingHoursCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  entries: WorkingHoursEntryInput[];
  correlationId?: string;
}
