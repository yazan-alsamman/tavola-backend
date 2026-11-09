import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ReopenReviewCommand {
  actor: AuthenticatedOrganizationMemberActor;
  reviewId: string;
  correlationId?: string;
}
