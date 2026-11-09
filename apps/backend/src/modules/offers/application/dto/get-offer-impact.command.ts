import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface GetOfferImpactCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  offerId: string;
}
