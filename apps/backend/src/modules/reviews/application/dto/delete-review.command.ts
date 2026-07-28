import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface DeleteReviewCommand {
  actor: AuthenticatedActor;
  reviewId: string;
  correlationId?: string;
}
