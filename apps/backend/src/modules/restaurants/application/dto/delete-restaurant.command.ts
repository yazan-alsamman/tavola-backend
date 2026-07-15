import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface DeleteRestaurantCommand {
  actor: AuthenticatedOrganizationMemberActor;
  restaurantId: string;
  correlationId?: string;
}
