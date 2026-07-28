import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';

export interface ListMyReviewsCommand {
  actor: AuthenticatedActor;
  page: number;
  limit: number;
}
