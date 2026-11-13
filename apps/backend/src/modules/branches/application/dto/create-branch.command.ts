import { BranchFeature, BranchVenueType } from '../../domain/enums/branch.enums';
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
  /** ADR-053: omitted keeps the stored value (update) or leaves it empty (create). */
  venueType?: BranchVenueType | null;
  features?: BranchFeature[];
  correlationId?: string;
}
