import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { UserId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FavoriteRestaurantRepository,
  FAVORITE_RESTAURANT_REPOSITORY,
} from '../../domain/repositories/favorite-restaurant.repository';
import { RemoveFavoriteCommand } from '../dto/remove-favorite.command';

/**
 * Idempotent by product decision, mirroring `AddFavoriteUseCase`: removing a
 * favorite that does not exist (already removed, never existed, or belongs
 * to another user) is a silent no-op rather than a 404 - the repository's
 * `remove()` never distinguishes "removed" from "was never there", which
 * also means this use case cannot be tricked into confirming/denying that
 * another user favorited a given restaurant.
 */
@Injectable()
export class RemoveFavoriteUseCase {
  constructor(
    @Inject(FAVORITE_RESTAURANT_REPOSITORY)
    private readonly favoriteRepository: FavoriteRestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: RemoveFavoriteCommand): Promise<void> {
    const userId = UserId.create(command.actor.userId);
    const restaurantId = RestaurantId.create(command.restaurantId);

    await this.favoriteRepository.remove(userId, restaurantId);

    const now = this.clock.now();
    await this.auditLogWriter.record({
      actorId: userId.value,
      actorType: 'User',
      action: 'user.favorite.removed',
      targetType: 'Restaurant',
      targetId: restaurantId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: command.ipAddress,
      occurredAt: now,
    });
  }
}
