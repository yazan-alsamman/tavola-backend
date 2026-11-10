import { Injectable, Inject } from '@nestjs/common';
import { ClockPort, CLOCK } from '@shared/application/ports/clock.port';
import { IdGeneratorPort, ID_GENERATOR } from '@shared/application/ports/id-generator.port';
import {
  EventPublisherPort,
  EVENT_PUBLISHER,
} from '@shared/application/ports/event-publisher.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewReopenedEvent } from '../../domain/events/review.events';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { ReopenReviewCommand } from '../dto/reopen-review.command';
import { ReviewResult } from '../dto/review.result';

/**
 * ADR-045: after talking to the guest, the restaurant (Owner/Admin) opens a
 * review so its guest may rate again. Whether to rate again stays the
 * guest's decision; nothing about the review changes until they do.
 * Tenant gate as in `ReplyToReviewUseCase`.
 */
@Injectable()
export class ReopenReviewUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: ReopenReviewCommand): Promise<ReviewResult> {
    const review = await this.reviewRepository.findById(ReviewId.create(command.reviewId));
    if (review === null) {
      throw new ReviewNotFoundException();
    }
    const restaurant = await this.restaurantRepository.findById(review.restaurantId);
    if (restaurant === null || restaurant.organizationId.value !== command.actor.organizationId) {
      throw new ReviewNotFoundException();
    }
    if (review.isOpenForRerating()) {
      return this.resultAssembler.assemble(review);
    }

    const now = this.clock.now();
    const reopened = review.reopen(now);
    await this.reviewRepository.update(reopened);

    await this.eventPublisher.publish(
      new ReviewReopenedEvent(
        this.idGenerator.generate(),
        {
          reviewId: reopened.reviewId.value,
          restaurantId: reopened.restaurantId.value,
          reservationId: reopened.reservationId.value,
          reopenedBy: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.reopened',
      targetType: 'Review',
      targetId: reopened.reviewId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return this.resultAssembler.assemble(reopened);
  }
}
