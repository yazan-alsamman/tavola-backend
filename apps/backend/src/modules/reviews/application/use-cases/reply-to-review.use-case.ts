import { Injectable, Inject } from '@nestjs/common';
import { ClockPort } from '@shared/application/ports/clock.port';
import { IdGeneratorPort } from '@shared/application/ports/id-generator.port';
import { EventPublisherPort } from '@shared/application/ports/event-publisher.port';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import {
  AuditLogWriterPort,
  AUDIT_LOG_WRITER,
} from '@shared/application/ports/audit-log-writer.port';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CLOCK,
  ID_GENERATOR,
  EVENT_PUBLISHER,
  UNIT_OF_WORK,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import {
  RestaurantRepository,
  RESTAURANT_REPOSITORY,
} from '@modules/restaurants/domain/repositories/restaurant.repository';
import { ReviewRepository, REVIEW_REPOSITORY } from '../../domain/repositories/review.repository';
import {
  RestaurantReplyRepository,
  RESTAURANT_REPLY_REPOSITORY,
} from '../../domain/repositories/restaurant-reply.repository';
import { RestaurantReply } from '../../domain/entities/restaurant-reply.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { RestaurantRepliedToReviewEvent } from '../../domain/events/review.events';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { ReplyToReviewCommand } from '../dto/reply-to-review.command';
import { ReviewResult } from '../dto/review.result';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26, owner decisions
 * #10/#11/#12). Organization Owner/Admin only - route guarded by
 * `OrganizationMemberGuard`+`@RequireOrgRole(Owner, Admin)` (standard guard
 * composition, no dual-actor branching needed since there is no Customer or
 * Employee path at all). Zero-or-one per Review, immutable once created.
 */
@Injectable()
export class ReplyToReviewUseCase {
  constructor(
    @Inject(REVIEW_REPOSITORY) private readonly reviewRepository: ReviewRepository,
    @Inject(RESTAURANT_REPOSITORY) private readonly restaurantRepository: RestaurantRepository,
    @Inject(RESTAURANT_REPLY_REPOSITORY)
    private readonly restaurantReplyRepository: RestaurantReplyRepository,
    @Inject(CLOCK) private readonly clock: ClockPort,
    @Inject(ID_GENERATOR) private readonly idGenerator: IdGeneratorPort,
    @Inject(EVENT_PUBLISHER) private readonly eventPublisher: EventPublisherPort,
    @Inject(UNIT_OF_WORK) private readonly unitOfWork: UnitOfWorkPort,
    @Inject(AUDIT_LOG_WRITER) private readonly auditLogWriter: AuditLogWriterPort,
    private readonly resultAssembler: ReviewResultAssembler,
  ) {}

  async execute(command: ReplyToReviewCommand): Promise<ReviewResult> {
    const reviewId = ReviewId.create(command.reviewId);
    const review = await this.reviewRepository.findById(reviewId);
    if (review === null) {
      throw new ReviewNotFoundException();
    }

    // Tenant isolation gate: `Restaurant` is a `DIRECT_TENANT_OWNED_MODEL`,
    // so a cross-organization Review's restaurant resolves to `null` here in
    // production (Prisma extension, fail-closed). The explicit
    // `organizationId` comparison below is defense-in-depth
    // (AUTHORIZATION_ARCHITECTURE.md §11: "Verify JWT organizationId matches
    // resource's organization"), mirroring `assertActorCanDeleteReview`'s own
    // explicit check - never rely on implicit repository-level tenant
    // scoping alone.
    const restaurant = await this.restaurantRepository.findById(review.restaurantId);
    if (restaurant === null || restaurant.organizationId.value !== command.actor.organizationId) {
      throw new ReviewNotFoundException();
    }

    const now = this.clock.now();
    const reply = RestaurantReply.create({
      id: this.idGenerator.generate(),
      reviewId: review.reviewId.value,
      repliedByUserId: command.actor.userId,
      comment: command.comment,
      createdAt: now,
      updatedAt: now,
    });

    // Database-level authority: a losing concurrent reply attempt is
    // rejected by `UNIQUE(reviewId)` here (P2002 ->
    // `ReviewAlreadyRepliedException`), never relying on a pre-check alone.
    await this.unitOfWork.execute(async () => {
      await this.restaurantReplyRepository.create(reply);
    });

    await this.eventPublisher.publish(
      new RestaurantRepliedToReviewEvent(
        this.idGenerator.generate(),
        {
          reviewId: review.reviewId.value,
          restaurantId: review.restaurantId.value,
          repliedByUserId: command.actor.userId,
        },
        now,
        command.correlationId,
      ),
    );

    await this.auditLogWriter.record({
      actorId: command.actor.userId,
      actorType: 'User',
      action: 'review.replied',
      targetType: 'Review',
      targetId: review.reviewId.value,
      organizationId: command.actor.organizationId,
      correlationId: command.correlationId ?? null,
      ipAddress: null,
      occurredAt: now,
    });

    return this.resultAssembler.assemble(review);
  }
}
