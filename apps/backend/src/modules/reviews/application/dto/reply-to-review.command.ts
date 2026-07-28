import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ReplyToReviewCommand {
  actor: AuthenticatedOrganizationMemberActor;
  reviewId: string;
  comment: string;
  correlationId?: string;
}
