import { ReplyToReviewUseCase } from './reply-to-review.use-case';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewAlreadyRepliedException } from '../../domain/exceptions/review-already-replied.exception';
import { RestaurantRepliedToReviewEvent } from '../../domain/events/review.events';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  CollectingEventPublisher,
  CollectingAuditLogWriter,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import {
  FIXED_NOW,
  testRestaurant,
  testUser,
} from '../../../../../test/reviews/support/review-test-fixtures';

describe('ReplyToReviewUseCase', () => {
  const organizationId = '99999999-9999-4999-8999-999999999999';
  const otherOrganizationId = '99999999-9999-4999-8999-999999999998';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const reviewId = '11111111-1111-4111-8111-111111111111';
  const ownerUserId = '55555555-5555-4555-8555-555555555555';

  function orgMemberActor(overrides?: { organizationId?: string }) {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: ownerUserId,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: overrides?.organizationId ?? organizationId,
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
  }

  async function build() {
    const reviewRepository = new InMemoryReviewRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const restaurantReplyRepository = new InMemoryRestaurantReplyRepository();
    const reviewImageRepository = new InMemoryReviewImageRepository();
    const userRepository = new InMemoryUserRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const eventPublisher = new CollectingEventPublisher();
    const auditLogWriter = new CollectingAuditLogWriter();

    await restaurantRepository.save(testRestaurant({ id: restaurantId, organizationId }));
    await userRepository.save(testUser({ id: ownerUserId, username: 'owner_jane' }));
    reviewRepository.seed(
      Review.create({
        id: reviewId,
        userId: '22222222-2222-4222-8222-222222222222',
        restaurantId,
        reservationId: '44444444-4444-4444-8444-444444444444',
        rating: 5,
        comment: 'Great!',
        now: FIXED_NOW,
      }),
    );

    const resultAssembler = new ReviewResultAssembler(
      userRepository,
      reviewImageRepository,
      restaurantReplyRepository,
      fileRepository,
      storagePort,
    );

    const useCase = new ReplyToReviewUseCase(
      reviewRepository,
      restaurantRepository,
      restaurantReplyRepository,
      new FixedClock(FIXED_NOW),
      new UuidGenerator(),
      eventPublisher,
      new ImmediateUnitOfWork(),
      auditLogWriter,
      resultAssembler,
    );

    return { useCase, restaurantReplyRepository, eventPublisher, auditLogWriter };
  }

  it('allows an Organization Owner/Admin to reply once', async () => {
    const { useCase } = await build();
    const result = await useCase.execute({
      actor: orgMemberActor(),
      reviewId,
      comment: 'Thank you!',
    });

    expect(result.reply).toEqual({ comment: 'Thank you!', createdAt: FIXED_NOW });
  });

  it('rejects a second reply with ReviewAlreadyRepliedException', async () => {
    const { useCase } = await build();
    await useCase.execute({ actor: orgMemberActor(), reviewId, comment: 'First reply' });

    await expect(
      useCase.execute({ actor: orgMemberActor(), reviewId, comment: 'Second reply' }),
    ).rejects.toBeInstanceOf(ReviewAlreadyRepliedException);
  });

  it('collapses a cross-organization reply attempt to ReviewNotFoundException (IDOR-safe)', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: orgMemberActor({ organizationId: otherOrganizationId }),
        reviewId,
        comment: 'Not allowed',
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('rejects replying to an unknown review', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: orgMemberActor(),
        reviewId: '00000000-0000-4000-8000-000000000000',
        comment: 'Hi',
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('publishes RestaurantRepliedToReviewEvent with the frozen payload shape and writes an audit row', async () => {
    const { useCase, eventPublisher, auditLogWriter } = await build();
    await useCase.execute({
      actor: orgMemberActor(),
      reviewId,
      comment: 'Thank you!',
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as RestaurantRepliedToReviewEvent;
    expect(event).toBeInstanceOf(RestaurantRepliedToReviewEvent);
    expect(event.eventName).toBe('RestaurantRepliedToReview');
    expect(event.payload).toMatchObject({ reviewId, restaurantId, repliedByUserId: ownerUserId });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: ownerUserId,
      actorType: 'User',
      action: 'review.replied',
      organizationId,
    });
  });

  it('reply is immutable - the reply repository exposes no update method', async () => {
    const { useCase, restaurantReplyRepository } = await build();
    await useCase.execute({ actor: orgMemberActor(), reviewId, comment: 'Thank you!' });
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(restaurantReplyRepository));
    expect(methods).not.toContain('update');
  });
});
