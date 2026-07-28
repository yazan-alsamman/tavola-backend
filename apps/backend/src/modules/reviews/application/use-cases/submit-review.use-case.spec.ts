import { SubmitReviewUseCase } from './submit-review.use-case';
import { ReviewAlreadyExistsException } from '../../domain/exceptions/review-already-exists.exception';
import { ReservationNotCompletedException } from '../../domain/exceptions/reservation-not-completed.exception';
import { ReservationNotFoundException } from '@modules/reservations/domain/exceptions/reservation-not-found.exception';
import { ReviewCreatedEvent } from '../../domain/events/review.events';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import {
  CollectingEventPublisher,
  CollectingAuditLogWriter,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReservationRepository } from '../../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { ReviewResultAssembler } from '../services/review-result-assembler.service';
import { InMemoryUserRepository } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryReviewImageRepository } from '../../../../../test/reviews/support/in-memory-review-image.repository';
import { InMemoryRestaurantReplyRepository } from '../../../../../test/reviews/support/in-memory-restaurant-reply.repository';
import { InMemoryFileRepository } from '../../../../../test/restaurants/support/in-memory-file-repository';
import { FakeStoragePort } from '../../../../../test/restaurants/support/fake-storage-port';
import {
  FIXED_NOW,
  testUser,
  testRestaurant,
  testCompletedReservation,
  testPendingReservation,
} from '../../../../../test/reviews/support/review-test-fixtures';

describe('SubmitReviewUseCase', () => {
  const organizationId = '99999999-9999-4999-8999-999999999999';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const branchId = '55555555-5555-4555-8555-555555555555';
  const tableId = '66666666-6666-4666-8666-666666666666';
  const userId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '22222222-2222-4222-8222-222222222299';
  const reservationId = '44444444-4444-4444-8444-444444444444';

  function userActor(id: string = userId) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  async function build() {
    const reservationRepository = new InMemoryReservationRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const reviewRepository = new InMemoryReviewRepository();
    const userRepository = new InMemoryUserRepository();
    const reviewImageRepository = new InMemoryReviewImageRepository();
    const restaurantReplyRepository = new InMemoryRestaurantReplyRepository();
    const fileRepository = new InMemoryFileRepository();
    const storagePort = new FakeStoragePort();
    const eventPublisher = new CollectingEventPublisher();
    const auditLogWriter = new CollectingAuditLogWriter();

    restaurantRepository.setReviewSource(() => reviewRepository.listAllForAverageRating());

    await restaurantRepository.save(testRestaurant({ id: restaurantId, organizationId }));
    await userRepository.save(testUser({ id: userId, username: 'jane_doe' }));

    const resultAssembler = new ReviewResultAssembler(
      userRepository,
      reviewImageRepository,
      restaurantReplyRepository,
      fileRepository,
      storagePort,
    );

    const useCase = new SubmitReviewUseCase(
      reservationRepository,
      restaurantRepository,
      reviewRepository,
      new FixedClock(FIXED_NOW),
      new UuidGenerator(),
      eventPublisher,
      new ImmediateUnitOfWork(),
      auditLogWriter,
      resultAssembler,
    );

    return {
      useCase,
      reservationRepository,
      restaurantRepository,
      reviewRepository,
      eventPublisher,
      auditLogWriter,
    };
  }

  it('submits a review for the caller own Completed reservation', async () => {
    const { useCase, reservationRepository, restaurantRepository } = await build();
    reservationRepository.seed(
      testCompletedReservation({ id: reservationId, userId, restaurantId, branchId, tableId }),
    );

    const result = await useCase.execute({
      actor: userActor(),
      reservationId,
      rating: 5,
      comment: 'Wonderful!',
    });

    expect(result.rating).toBe(5);
    expect(result.comment).toBe('Wonderful!');
    expect(result.reviewerUsername).toBe('jane_doe');

    const restaurant = await restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(restaurant?.averageRating).toBe(5);
  });

  it('allows a rating-only review with no comment', async () => {
    const { useCase, reservationRepository } = await build();
    reservationRepository.seed(
      testCompletedReservation({ id: reservationId, userId, restaurantId, branchId, tableId }),
    );

    const result = await useCase.execute({
      actor: userActor(),
      reservationId,
      rating: 3,
      comment: null,
    });

    expect(result.comment).toBeNull();
  });

  it('rejects a reservation that is not Completed', async () => {
    const { useCase, reservationRepository } = await build();
    reservationRepository.seed(
      testPendingReservation({ id: reservationId, userId, restaurantId, branchId, tableId }),
    );

    await expect(
      useCase.execute({ actor: userActor(), reservationId, rating: 5, comment: null }),
    ).rejects.toBeInstanceOf(ReservationNotCompletedException);
  });

  it('rejects a reservation not owned by the caller (IDOR-safe 404)', async () => {
    const { useCase, reservationRepository } = await build();
    reservationRepository.seed(
      testCompletedReservation({ id: reservationId, userId, restaurantId, branchId, tableId }),
    );

    await expect(
      useCase.execute({ actor: userActor(otherUserId), reservationId, rating: 5, comment: null }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('rejects a guest-only reservation (userId null) as not found', async () => {
    const { useCase, reservationRepository } = await build();
    reservationRepository.seed(
      testCompletedReservation({
        id: reservationId,
        userId: null,
        reservationGuestId: '77777777-7777-4777-8777-777777777777',
        restaurantId,
        branchId,
        tableId,
      }),
    );

    await expect(
      useCase.execute({ actor: userActor(), reservationId, rating: 5, comment: null }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('rejects an unknown reservation', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: userActor(),
        reservationId: '00000000-0000-4000-8000-000000000000',
        rating: 5,
        comment: null,
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });

  it('rejects a duplicate review for the same reservation', async () => {
    const { useCase, reservationRepository } = await build();
    reservationRepository.seed(
      testCompletedReservation({ id: reservationId, userId, restaurantId, branchId, tableId }),
    );

    await useCase.execute({ actor: userActor(), reservationId, rating: 5, comment: null });

    await expect(
      useCase.execute({ actor: userActor(), reservationId, rating: 4, comment: null }),
    ).rejects.toBeInstanceOf(ReviewAlreadyExistsException);
  });

  it('publishes ReviewCreatedEvent with the frozen payload shape and writes an audit row', async () => {
    const { useCase, reservationRepository, eventPublisher, auditLogWriter } = await build();
    reservationRepository.seed(
      testCompletedReservation({ id: reservationId, userId, restaurantId, branchId, tableId }),
    );

    await useCase.execute({
      actor: userActor(),
      reservationId,
      rating: 5,
      comment: null,
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as ReviewCreatedEvent;
    expect(event).toBeInstanceOf(ReviewCreatedEvent);
    expect(event.eventName).toBe('ReviewCreated');
    expect(event.correlationId).toBe('corr-1');
    expect(event.payload).toMatchObject({ restaurantId, reservationId, userId, rating: 5 });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: userId,
      actorType: 'User',
      action: 'review.created',
      targetType: 'Review',
    });
  });

  it('rejects a non-Customer actor as not found (no eligible reservation)', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: {
          actorType: AccessTokenActorType.OrganizationMember as const,
          userId,
          sessionId: 'session-1',
          sessionVersion: 1,
          tokenFamilyId: 'family-1',
          organizationId,
          orgRole: 'Owner',
          permissionsVersion: 1,
        },
        reservationId,
        rating: 5,
        comment: null,
      }),
    ).rejects.toBeInstanceOf(ReservationNotFoundException);
  });
});
