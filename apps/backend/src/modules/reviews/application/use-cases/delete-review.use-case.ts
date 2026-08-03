import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort, UNIT_OF_WORK } from '@shared/application/ports/unit-of-work.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewDeletedEvent } from '../../domain/events/review.events';
import { assertActorCanDeleteReview } from '../services/assert-actor-can-delete-review';
import { DeleteReviewCommand } from '../dto/delete-review.command';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decisions
 * #7/#8/#9). Soft delete only. Reachable by the owning Customer or a
 * Restaurant Organization Owner/Admin - dual-actor authorization resolved
 * inside this use case (`assertActorCanDeleteReview`), route guarded only by
 * `JwtAuthGuard`/`SessionVersionGuard` (no `OrganizationMemberGuard`, which
 * would otherwise structurally deny the Customer path).
 */
@Injectable()
export class DeleteReviewUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
  ) {}

  async execute(command: DeleteReviewCommand): Promise<void> {
    const reviewId = ReviewId.create(command.reviewId);
    const review = await this.reviewRepository.findById(reviewId);
    if (review === null) {
      throw new ReviewNotFoundException();
    }

    // Only resolved for an OrganizationMember actor - the Customer-ownership
    // path never needs the Restaurant/organization at all. `findById` here
    // is tenant-scoped (`Restaurant` is a `DIRECT_TENANT_OWNED_MODEL`), so a
    // cross-organization Review's restaurant resolves to `null`, collapsing
    // to the same 404 a genuinely unknown Review produces (IDOR-safe).
    let restaurantOrganizationId = '';
    if (command.actor.actorType === AccessTokenActorType.OrganizationMember) {
      const restaurant = await this.restaurantRepository.findById(review.restaurantId);
      if (restaurant === null) {
        throw new ReviewNotFoundException();
      }
      restaurantOrganizationId = restaurant.organizationId.value;
    }
    assertActorCanDeleteReview(command.actor, review, restaurantOrganizationId);

    const now = this.clock.now();
    await this.unitOfWork.execute(async () => {
      // Lock first - see `lockForRatingRecompute`'s doc comment. Delete's
      // own soft-delete UPDATE takes no FK lock on the Restaurant row, so
      // this ordering isn't deadlock-prone the way Submit's is, but the
      // lock is still required to avoid losing a concurrent recompute.
      await this.restaurantRepository.lockForRatingRecompute(review.restaurantId);
      await this.reviewRepository.softDelete(reviewId, now);
      await this.restaurantRepository.recomputeAverageRating(review.restaurantId, now);
    });

    await this.eventPublisher.publish(
      new ReviewDeletedEvent(
        this.idGenerator.generate(),
        {
          reviewId: review.reviewId.value,
          restaurantId: review.restaurantId.value,
          reservationId: review.reservationId.value,
          deletedBy: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.deleted',
      targetType: 'Review',
      targetId: review.reviewId.value,
      organizationId:
        command.actor.actorType === AccessTokenActorType.OrganizationMember
          ? command.actor.organizationId
          : null,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });
  }
}
