import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReviewContent } from '../../domain/entities/review.entity';

export interface RerateReviewCommand {
  actor: AuthenticatedActor;
  reviewId: string;
  content: ReviewContent;
  correlationId?: string;
}
