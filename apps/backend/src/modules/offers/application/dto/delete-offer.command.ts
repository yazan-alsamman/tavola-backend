import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface DeleteOfferCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  offerId: string;
  correlationId?: string;
}
