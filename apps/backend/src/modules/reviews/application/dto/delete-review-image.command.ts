import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface DeleteReviewImageCommand {
  actor: AuthenticatedActor;
  reviewId: string;
  reviewImageId: string;
  correlationId?: string;
}
