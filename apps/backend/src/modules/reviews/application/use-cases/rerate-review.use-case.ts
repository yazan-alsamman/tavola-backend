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
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewReratedEvent } from '../../domain/events/review.events';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { RerateReviewCommand } from '../dto/rerate-review.command';
import { ReviewResult } from '../dto/review.result';

/**
 * ADR-045: the guest rates again, only while the restaurant has the review
 * open (`ReviewNotReopenedException` otherwise). The new rating replaces the
 * old one and the restaurant's average is recomputed in the same
 * transaction, under the same row lock as submit/delete.
 */
@Injectable()
export class RerateReviewUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: RerateReviewCommand): Promise<ReviewResult> {
    const review = await this.reviewRepository.findById(ReviewId.create(command.reviewId));
    if (
      review === null ||
      command.actor.actorType !== AccessTokenActorType.User ||
      review.userId.value !== command.actor.userId
    ) {
      throw new ReviewNotFoundException();
    }

    const now = this.clock.now();
    const rerated = review.rerate(command.content, now);

    await this.unitOfWork.execute(async () => {
      await this.restaurantRepository.lockForRatingRecompute(rerated.restaurantId);
      await this.reviewRepository.update(rerated);
      await this.restaurantRepository.recomputeAverageRating(rerated.restaurantId, now);
    });

    const reservation = await this.reservationRepository.findById(rerated.reservationId);
    if (reservation !== null) {
      await this.eventPublisher.publish(
        new ReviewReratedEvent(
          this.idGenerator.generate(),
          {
            reviewId: rerated.reviewId.value,
            restaurantId: rerated.restaurantId.value,
            reservationId: rerated.reservationId.value,
            userId: rerated.userId.value,
            previousScore: review.score,
            score: rerated.score,
            branchId: reservation.branchId.value,
          },
          now,
          command.correlationId,
        ),
      );
    }

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.rerated',
      targetType: 'Review',
      targetId: rerated.reviewId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return this.resultAssembler.assemble(rerated);
  }
}
