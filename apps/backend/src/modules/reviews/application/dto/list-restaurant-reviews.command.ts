import { AuthenticatedOrganizationMemberActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ReviewListFilter } from '../../domain/repositories/review.repository';

export interface ListRestaurantReviewsCommand {
  restaurantId: string;
  page: number;
  limit: number;
  filter?: ReviewListFilter;
}

/** The restaurant's own list: same filters, plus each guest's private note. */
export interface ListRestaurantReviewsForStaffCommand extends ListRestaurantReviewsCommand {
  actor: AuthenticatedOrganizationMemberActor;
}
