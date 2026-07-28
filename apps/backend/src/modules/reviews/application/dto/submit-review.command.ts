import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface SubmitReviewCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  rating: number;
  comment: string | null;
  correlationId?: string;
}
