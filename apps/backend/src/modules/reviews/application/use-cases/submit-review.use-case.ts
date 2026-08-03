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
import { ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  ReservationRepository,
  RESERVATION_REPOSITORY,
} from '@modules/reservations/domain/repositories/reservation.repository';
import { ReservationStatus } from '@modules/reservations/domain/enums/reservation.enums';
import { ReservationNotFoundException } from '@modules/reservations/domain/exceptions/reservation-not-found.exception';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { Review } from '../../domain/entities/review.entity';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import { ReviewAlreadyExistsException } from '../../domain/exceptions/review-already-exists.exception';
import { ReservationNotCompletedException } from '../../domain/exceptions/reservation-not-completed.exception';
import { ReviewCreatedEvent } from '../../domain/events/review.events';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { SubmitReviewCommand } from '../dto/submit-review.command';
import { ReviewResult } from '../dto/review.result';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decisions #1-3).
 * Ownership-only, no RBAC (`JwtAuthGuard`/`SessionVersionGuard` route only) -
 * mirrors `CreateReservationUseCase`'s own "any authenticated actor may act
 * for themselves" shape. `Reservation.userId === null` (guest-only,
 * Phone/WalkIn) fails the ownership comparison below and collapses to the
 * exact same `ReservationNotFoundException` as a genuinely unknown/foreign
 * reservation - no separate "guest reservation" branch or message exists,
 * since the reason is uniformly "no eligible Reservation to review" from the
 * caller's perspective (IDOR-safe, IDOR discipline applied to non-existence
 * as much as to identity).
 */
@Injectable()
export class SubmitReviewUseCase {
  constructor(
    @Inject(RESERVATION_REPOSITORY) private readonly reservationRepository: ReservationRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: SubmitReviewCommand): Promise<ReviewResult> {
    if (command.actor.actorType !== AccessTokenActorType.User) {
      // Only a Customer/User actor may ever own a Reservation the way
      // Decision 1 requires - any other actor type has no eligible
      // Reservation to review at all (collapses identically to "not found",
      // never a distinguishing 403, matching every other IDOR-safe route).
      throw new ReservationNotFoundException();
    }

    const reservationId = ReservationId.create(command.reservationId);
    const reservation = await this.reservationRepository.findById(reservationId);
    if (reservation === null || reservation.userId?.value !== command.actor.userId) {
      throw new ReservationNotFoundException();
    }
    if (reservation.status !== ReservationStatus.Completed) {
      throw new ReservationNotCompletedException();
    }

    const existing = await this.reviewRepository.findByReservationId(reservationId);
    if (existing !== null) {
      throw new ReviewAlreadyExistsException();
    }

    const now = this.clock.now();
    const review = Review.create({
      id: this.idGenerator.generate(),
      userId: command.actor.userId,
      restaurantId: reservation.restaurantId.value,
      reservationId: reservationId.value,
      rating: command.rating,
      comment: command.comment,
      now,
    });

    await this.unitOfWork.execute(async () => {
      // Lock the Restaurant row BEFORE inserting - must precede the review
      // insert, not follow it (see `lockForRatingRecompute`'s doc comment:
      // locking afterward both loses concurrent averageRating updates and
      // deadlocks against the review insert's own FK lock).
      await this.restaurantRepository.lockForRatingRecompute(review.restaurantId);
      // Database-level authority: a losing concurrent submit for the same
      // reservation is rejected by `UNIQUE(reservationId)` here (P2002 ->
      // `ReviewAlreadyExistsException`), never relying on the pre-check
      // above alone.
      await this.reviewRepository.create(review);
      await this.restaurantRepository.recomputeAverageRating(review.restaurantId, now);
    });

    await this.eventPublisher.publish(
      new ReviewCreatedEvent(
        this.idGenerator.generate(),
        {
          reviewId: review.reviewId.value,
          restaurantId: review.restaurantId.value,
          reservationId: review.reservationId.value,
          userId: review.userId.value,
          rating: review.rating,
        },
        now,
        command.correlationId,
      ),
    );

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.created',
      targetType: 'Review',
      targetId: review.reviewId.value,
      organizationId: null,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return this.resultAssembler.assemble(review);
  }
}
