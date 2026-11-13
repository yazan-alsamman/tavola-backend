import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetBranchSettingsCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  branchId: string;
}

export interface BranchSettingsRules {
  reservationIntervalMinutes: number;
  maxGuestsPerReservation: number;
  cancellationWindowMinutes: number;
  pendingReservationTimeoutMinutes: number;
  defaultReservationDurationMinutes: number;
  autoApproval: boolean;
  reservationReminderMinutesBefore: number;
  lateArrivalGraceMinutes: number;
  /** ADR-053 booking limits: omitted keeps the stored value, null removes the limit. */
  autoApprovalMaxGuests?: number | null;
  minLeadTimeMinutes?: number;
  maxDaysAhead?: number | null;
  dailyGuestCap?: number | null;
}

export interface UpdateBranchSettingsCommand extends GetBranchSettingsCommand, BranchSettingsRules {
  correlationId?: string;
}
