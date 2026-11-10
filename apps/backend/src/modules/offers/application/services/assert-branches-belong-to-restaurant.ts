import { BranchId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { BranchRepository } from '@modules/branches/domain/repositories/branch.repository';
import { InvalidOfferException } from '../../domain/exceptions/invalid-offer.exception';

/**
 * ADR-047: an offer's `branchIds` must all be branches of its restaurant.
 * A foreign or unknown id is a 400, never silently dropped.
 */
export async function assertBranchesBelongToRestaurant(
  branchRepository: BranchRepository,
  branchIds: string[],
  restaurantId: RestaurantId,
): Promise<void> {
  for (const id of new Set(branchIds)) {
    const branch = await branchRepository.findByIdAndRestaurantId(
      BranchId.create(id),
      restaurantId,
    );
    if (branch === null) {
      throw new InvalidOfferException(
        `branchIds contains a branch outside this restaurant: ${id}.`,
      );
    }
  }
}
