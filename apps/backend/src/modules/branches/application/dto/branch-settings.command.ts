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
}

export interface UpdateBranchSettingsCommand extends GetBranchSettingsCommand, BranchSettingsRules {
  correlationId?: string;
}
