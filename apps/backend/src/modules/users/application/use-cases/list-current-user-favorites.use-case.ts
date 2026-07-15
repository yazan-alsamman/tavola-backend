import { Injectable, Inject } from '@nestjs/common';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FavoriteRestaurantRepository,
  FAVORITE_RESTAURANT_REPOSITORY,
} from '../../domain/repositories/favorite-restaurant.repository';
import {
  RestaurantDirectoryReaderPort,
  RestaurantSummary,
  RESTAURANT_DIRECTORY_READER,
} from '../ports/restaurant-directory-reader.port';
import { ListFavoritesCommand } from '../dto/list-favorites.command';
import { FavoriteListResult } from '../dto/favorite-list.result';

/**
 * Ordering: most-recently-favorited first (`createdAt desc`) - a reasonable
 * default judgment call (neither PRODUCT_REQUIREMENTS.md nor
 * API_GUIDELINES.md specify Favorites ordering).
 *
 * Restaurant summaries are batch-fetched (`findManyByIds`) to avoid an N+1
 * query per favorite (CODING_STANDARDS.md performance rule). A favorite
 * whose restaurant has since been soft-deleted is silently excluded from
 * `items` (never auto-deleting the underlying Favorite row) - `meta.total`
 * still reflects the raw Favorite count, so a page can legitimately return
 * fewer than `limit` items when this happens. Documented as a known,
 * accepted limitation rather than building full re-paging logic for a rare
 * edge case, which would be scope creep for this minimal feature.
 */
@Injectable()
export class ListCurrentUserFavoritesUseCase {
  constructor(
    @Inject(FAVORITE_RESTAURANT_REPOSITORY)
    private readonly favoriteRepository: FavoriteRestaurantRepository,
    @Inject(RESTAURANT_DIRECTORY_READER)
    private readonly restaurantDirectoryReader: RestaurantDirectoryReaderPort,
  ) {}

  async execute(command: ListFavoritesCommand): Promise<FavoriteListResult> {
    const userId = UserId.create(command.actor.userId);

    const page = await this.favoriteRepository.listByUser(userId, command.page, command.limit);
    const restaurantIds = page.items.map((favorite) => favorite.restaurantId);
    const summaries = await this.restaurantDirectoryReader.findManyByIds(restaurantIds);
    const summaryById = new Map<string, RestaurantSummary>(
      summaries.map((summary) => [summary.id, summary]),
    );

    const items = page.items.flatMap((favorite) => {
      const summary = summaryById.get(favorite.restaurantId);
      if (summary === undefined) {
        return [];
      }
      return [
        {
          restaurantId: summary.id,
          name: summary.name,
          slug: summary.slug,
          cuisineType: summary.cuisineType,
          priceLevel: summary.priceLevel,
          averageRating: summary.averageRating,
          status: summary.status,
          favoritedAt: favorite.createdAt,
        },
      ];
    });

    return {
      items,
      page: command.page,
      limit: command.limit,
      total: page.total,
    };
  }
}
