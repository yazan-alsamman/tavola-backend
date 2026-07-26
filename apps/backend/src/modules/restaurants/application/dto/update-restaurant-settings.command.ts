import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

/** Full-replace semantics, matching every other update command in this
 * module - every field required, no partial-merge ambiguity. */
export interface UpdateRestaurantSettingsCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  reservationIntervalMinutes: number;
  maxGuestsPerReservation: number;
  cancellationWindowMinutes: number;
  pendingReservationTimeoutMinutes: number;
  defaultReservationDurationMinutes: number;
  autoApproval: boolean;
  timezone: string;
  defaultCurrency: string | null;
  reservationReminderMinutesBefore: number;
  lateArrivalGraceMinutes: number;
  correlationId?: string;
}
