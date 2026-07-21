import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface CreateBranchCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  city: string;
  district: string | null;
  address: string;
  latitude: number | null;
  longitude: number | null;
  countryCode: string;
  currency: string | null;
  timezone: string;
  phone: string | null;
  correlationId?: string;
}
