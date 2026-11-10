import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReviewContent } from '../../domain/entities/review.entity';

export interface SubmitReviewCommand {
  actor: AuthenticatedActor;
  reservationId: string;
  content: ReviewContent;
  correlationId?: string;
}
