import { ReopenReviewUseCase } from './reopen-review.use-case';
import { RerateReviewUseCase } from './rerate-review.use-case';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewNotReopenedException } from '../../domain/exceptions/review-not-reopened.exception';
import { ReviewReopenedEvent, ReviewReratedEvent } from '../../domain/events/review.events';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingAuditLogWriter,
  CollectingEventPublisher,
  FixedClock,
  ImmediateUnitOfWork,
  InMemoryUserRepository,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import {
  FIXED_NOW,
  testCompletedReservation,
  testRestaurant,
} from '../../../../../test/reviews/support/review-test-fixtures';

describe('Reopen and re-rate a review (ADR-045)', () => {
  const organizationId = '99999999-9999-4999-8999-999999999999';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '66666666-6666-4666-8666-666666666666';
  const tableId = '77777777-7777-4777-8777-777777777777';
  const reservationId = '44444444-4444-4444-8444-444444444444';
  const reviewId = '11111111-1111-4111-8111-111111111111';
  const guestUserId = '22222222-2222-4222-8222-222222222222';
  const ownerUserId = '55555555-5555-4555-8555-555555555555';

  const owner = (orgId = organizationId) => ({
    actorType: AccessTokenActorType.OrganizationMember as const,
    userId: ownerUserId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId: orgId,
    orgRole: 'Owner',
    permissionsVersion: 1,
  });

  const guest = (userId = guestUserId) => ({
    actorType: AccessTokenActorType.User as const,
    userId,
    sessionId: 'session-2',
    sessionVersion: 1,
    tokenFamilyId: 'family-2',
  });

  async function build() {
    const reviewRepository = new InMemoryReviewRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const reservationRepository = new InMemoryReservationRepository();
    const eventPublisher = new CollectingEventPublisher();
    const auditLogWriter = new CollectingAuditLogWriter();
    restaurantRepository.setReviewSource(() => reviewRepository.listAllForAverageRating());
    await restaurantRepository.save(testRestaurant({ id: restaurantId, organizationId }));
    reservationRepository.seed(
      testCompletedReservation({
        id: reservationId,
        userId: guestUserId,
        restaurantId,
        branchId,
        tableId,
      }),
    );
    reviewRepository.seed(
      Review.create({
        id: reviewId,
        userId: guestUserId,
        restaurantId,
        reservationId,
        rating: 2,
        comment: 'Slow',
        now: FIXED_NOW,
      }),
    );
    const assembler = new ReviewResultAssembler(
      new InMemoryUserRepository(),
      new InMemoryReviewImageRepository(),
      new InMemoryRestaurantReplyRepository(),
      new InMemoryFileRepository(),
      new FakeStoragePort(),
    );
    const clock = new FixedClock(FIXED_NOW);
    const reopen = new ReopenReviewUseCase(
      reviewRepository,
      restaurantRepository,
      clock,
      new UuidGenerator(),
      eventPublisher,
      auditLogWriter,
      assembler,
    );
    const rerate = new RerateReviewUseCase(
      reviewRepository,
      restaurantRepository,
      reservationRepository,
      clock,
      new UuidGenerator(),
      eventPublisher,
      new ImmediateUnitOfWork(),
      auditLogWriter,
      assembler,
    );
    return { reopen, rerate, reviewRepository, eventPublisher, auditLogWriter };
  }

  it('lets the guest rate again only after the restaurant opens the review', async () => {
    const { reopen, rerate, reviewRepository, eventPublisher } = await build();

    await expect(
      rerate.execute({ actor: guest(), reviewId, content: { rating: 5, comment: null } }),
    ).rejects.toBeInstanceOf(ReviewNotReopenedException);

    const opened = await reopen.execute({ actor: owner(), reviewId });
    expect(opened.openForRerating).toBe(true);
    expect(eventPublisher.events[0]).toBeInstanceOf(ReviewReopenedEvent);

    const result = await rerate.execute({
      actor: guest(),
      reviewId,
      content: {
        comment: null,
        axes: {
          service: { rating: 5, comment: 'Much better' },
          place: { rating: 5, comment: null },
          food: { rating: 4, comment: null },
        },
      },
    });
    expect(result.score).toBe(4.67);
    expect(result.openForRerating).toBe(false);
    expect(result.reratedAt).toEqual(FIXED_NOW);

    const stored = await reviewRepository.findById(ReviewId.create(reviewId));
    expect(stored?.score).toBe(4.67);
    const rerated = eventPublisher.events[1] as ReviewReratedEvent;
    expect(rerated).toBeInstanceOf(ReviewReratedEvent);
    expect(rerated.payload).toMatchObject({ previousScore: 2, score: 4.67, branchId });
  });

  it('hides the review from another organization and from another guest', async () => {
    const { reopen, rerate } = await build();
    await expect(
      reopen.execute({ actor: owner('99999999-9999-4999-8999-999999999998'), reviewId }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);

    await reopen.execute({ actor: owner(), reviewId });
    await expect(
      rerate.execute({
        actor: guest('88888888-8888-4888-8888-888888888888'),
        reviewId,
        content: { rating: 5, comment: null },
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('reopening an open review is a no-op (no second event or audit row)', async () => {
    const { reopen, eventPublisher, auditLogWriter } = await build();
    await reopen.execute({ actor: owner(), reviewId });
    await reopen.execute({ actor: owner(), reviewId });
    expect(eventPublisher.events).toHaveLength(1);
    expect(auditLogWriter.entries).toHaveLength(1);
  });
});
