import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface UpdateUserProfileCommand {
  actor: AuthenticatedActor;
  firstName: string;
  lastName: string;
  /**
   * ADR-022 Decision #13: both present together to set a canonical E.164
   * phone (normalized server-side via `PhoneNumber.create()`), both null to
   * clear it. Never a pre-assembled E.164 string from the client.
   */
  countryCode: string | null;
  phoneNumber: string | null;
  language: string;
  preferredCurrency: string | null;
  ipAddress: string | null;
  correlationId?: string;
}
