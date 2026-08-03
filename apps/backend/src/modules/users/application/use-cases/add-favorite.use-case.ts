import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { FavoriteRestaurant } from '../../domain/entities/favorite-restaurant.entity';
import {
  FavoriteRestaurantRepository,
  FAVORITE_RESTAURANT_REPOSITORY,
} from '../../domain/repositories/favorite-restaurant.repository';
import {
  RestaurantDirectoryReaderPort,
  RESTAURANT_DIRECTORY_READER,
} from '../ports/restaurant-directory-reader.port';
import { RestaurantNotFoundException } from '../exceptions/restaurant-not-found.exception';
import { AddFavoriteCommand } from '../dto/add-favorite.command';
import { FavoriteResult } from '../dto/favorite.result';

/**
 * Add is idempotent by product decision (section "REST API contract" of the
 * Favorites approval): favoriting an already-favorited restaurant succeeds
 * and returns the existing favorite rather than erroring, avoiding a
 * meaningless 409 for a harmless double-click/retry. Existence is checked via
 * `RestaurantDirectoryReaderPort` (not the repository) - a restaurant merely
 * needs to exist and not be soft-deleted; its operational `status`
 * (Active/Suspended/Closed) does not gate favoriting (a bookmark of intent
 * that can outlive a temporary suspension), a deliberate, documented scope
 * judgment since neither PRODUCT_REQUIREMENTS.md nor DOMAIN_MODEL.md specify
 * eligibility rules for this action.
 */
@Injectable()
export class AddFavoriteUseCase {
  constructor(
    @Inject(FAVORITE_RESTAURANT_REPOSITORY)
    private readonly favoriteRepository: FavoriteRestaurantRepository,
    @Inject(RESTAURANT_DIRECTORY_READER)
    private readonly restaurantDirectoryReader: RestaurantDirectoryReaderPort,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: AddFavoriteCommand): Promise<FavoriteResult> {
    const userId = UserId.create(command.actor.userId);
    const restaurantId = RestaurantId.create(command.restaurantId);

    const restaurant = await this.restaurantDirectoryReader.findById(restaurantId.value);
    if (restaurant === null) {
      throw new RestaurantNotFoundException();
    }

    const now = this.clock.now();
    const favorite = FavoriteRestaurant.create({
      id: this.idGenerator.generate(),
      userId: userId.value,
      restaurantId: restaurantId.value,
      createdAt: now,
    });

    const saved = await this.favoriteRepository.add(favorite);

    // Fire-and-forget, matching UpdateUserProfileUseCase/
    // UploadCurrentUserAvatarUseCase's existing precedent for user-initiated
    // self-resource mutations - no EVENTS.md entry exists for Favorites, so
    // a direct audit write is the smallest correct mechanism.
    await this.auditLogWriter.record({
      actorId: userId.value,
      actorType: 'User',
      action: 'user.favorite.added',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress,
      occurredAt: now,
    });

    return {
      restaurantId: saved.restaurantId,
      favoritedAt: saved.createdAt,
    };
  }
}
