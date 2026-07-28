import { DeleteReviewUseCase } from './delete-review.use-case';
import { Review } from '../../domain/entities/review.entity';
import { ReviewNotFoundException } from '../../domain/exceptions/review-not-found.exception';
import { ReviewDeletedEvent } from '../../domain/events/review.events';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { PermissionDeniedException } from '@modules/authorization/domain/exceptions/permission-denied.exception';
import {
  CollectingEventPublisher,
  CollectingAuditLogWriter,
  FixedClock,
  ImmediateUnitOfWork,
  UuidGenerator,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { InMemoryRestaurantRepository } from '../../../../../test/restaurants/support/in-memory-restaurant.repository';
import { InMemoryReviewRepository } from '../../../../../test/reviews/support/in-memory-review.repository';
import { RestaurantId, ReviewId } from '@shared/domain/value-objects/identifiers.vo';
import {
  FIXED_NOW,
  testRestaurant,
} from '../../../../../test/reviews/support/review-test-fixtures';

describe('DeleteReviewUseCase', () => {
  const organizationId = '99999999-9999-4999-8999-999999999999';
  const otherOrganizationId = '99999999-9999-4999-8999-999999999998';
  const restaurantId = '33333333-3333-4333-8333-333333333333';
  const reviewOwnerUserId = '22222222-2222-4222-8222-222222222222';
  const otherUserId = '22222222-2222-4222-8222-222222222299';
  const reviewId = '11111111-1111-4111-8111-111111111111';
  const reservationId = '44444444-4444-4444-8444-444444444444';

  function customerActor(id: string) {
    return {
      actorType: AccessTokenActorType.User as const,
      userId: id,
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
    };
  }

  function orgMemberActor(overrides?: { organizationId?: string; orgRole?: string }) {
    return {
      actorType: AccessTokenActorType.OrganizationMember as const,
      userId: 'owner-user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      organizationId: overrides?.organizationId ?? organizationId,
      orgRole: overrides?.orgRole ?? 'Owner',
      permissionsVersion: 1,
    };
  }

  function employeeActor() {
    return {
      actorType: AccessTokenActorType.Employee as const,
      userId: 'employee-user-1',
      sessionId: 'session-1',
      sessionVersion: 1,
      tokenFamilyId: 'family-1',
      employeeId: 'employee-1',
      organizationId,
      restaurantId,
      branchIds: [] as string[],
      permissions: ['reviews:manage'],
      permissionsVersion: 1,
    };
  }

  async function build() {
    const reviewRepository = new InMemoryReviewRepository();
    const restaurantRepository = new InMemoryRestaurantRepository();
    const eventPublisher = new CollectingEventPublisher();
    const auditLogWriter = new CollectingAuditLogWriter();

    restaurantRepository.setReviewSource(() => reviewRepository.listAllForAverageRating());
    await restaurantRepository.save(testRestaurant({ id: restaurantId, organizationId }));

    reviewRepository.seed(
      Review.create({
        id: reviewId,
        userId: reviewOwnerUserId,
        restaurantId,
        reservationId,
        rating: 4,
        comment: 'Nice',
        now: FIXED_NOW,
      }),
    );

    const useCase = new DeleteReviewUseCase(
      reviewRepository,
      restaurantRepository,
      new FixedClock(FIXED_NOW),
      new UuidGenerator(),
      eventPublisher,
      new ImmediateUnitOfWork(),
      auditLogWriter,
    );

    return { useCase, reviewRepository, restaurantRepository, eventPublisher, auditLogWriter };
  }

  it('allows the owning Customer to delete their own review', async () => {
    const { useCase, reviewRepository } = await build();
    await useCase.execute({ actor: customerActor(reviewOwnerUserId), reviewId });

    const review = await reviewRepository.findById(ReviewId.create(reviewId));
    expect(review).toBeNull();
  });

  it('recomputes averageRating to null after the only review is deleted', async () => {
    const { useCase, restaurantRepository } = await build();
    await useCase.execute({ actor: customerActor(reviewOwnerUserId), reviewId });

    const restaurant = await restaurantRepository.findById(RestaurantId.create(restaurantId));
    expect(restaurant?.averageRating).toBeNull();
  });

  it('rejects a Customer deleting a review they do not own (IDOR-safe 404)', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: customerActor(otherUserId), reviewId }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('allows an Organization Owner to administratively delete a review in their restaurant', async () => {
    const { useCase, reviewRepository } = await build();
    await useCase.execute({ actor: orgMemberActor({ orgRole: 'Owner' }), reviewId });
    expect(await reviewRepository.findById(ReviewId.create(reviewId))).toBeNull();
  });

  it('allows an Organization Admin to administratively delete a review', async () => {
    const { useCase, reviewRepository } = await build();
    await useCase.execute({ actor: orgMemberActor({ orgRole: 'Admin' }), reviewId });
    expect(await reviewRepository.findById(ReviewId.create(reviewId))).toBeNull();
  });

  it('rejects a non-Owner/Admin organization member with PermissionDeniedException', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: orgMemberActor({ orgRole: 'Member' }), reviewId }),
    ).rejects.toBeInstanceOf(PermissionDeniedException);
  });

  it('collapses a cross-organization Owner/Admin to ReviewNotFoundException (IDOR-safe)', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({ actor: orgMemberActor({ organizationId: otherOrganizationId }), reviewId }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('rejects an Employee actor with PermissionDeniedException - Employees may not delete reviews', async () => {
    const { useCase } = await build();
    await expect(useCase.execute({ actor: employeeActor(), reviewId })).rejects.toBeInstanceOf(
      PermissionDeniedException,
    );
  });

  it('rejects deleting an unknown review', async () => {
    const { useCase } = await build();
    await expect(
      useCase.execute({
        actor: customerActor(reviewOwnerUserId),
        reviewId: '00000000-0000-4000-8000-000000000000',
      }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('treats a second delete attempt as not found (idempotent collapse, not an error state)', async () => {
    const { useCase } = await build();
    await useCase.execute({ actor: customerActor(reviewOwnerUserId), reviewId });
    await expect(
      useCase.execute({ actor: customerActor(reviewOwnerUserId), reviewId }),
    ).rejects.toBeInstanceOf(ReviewNotFoundException);
  });

  it('publishes ReviewDeletedEvent with the frozen payload shape and writes an audit row', async () => {
    const { useCase, eventPublisher, auditLogWriter } = await build();
    await useCase.execute({
      actor: customerActor(reviewOwnerUserId),
      reviewId,
      correlationId: 'corr-1',
    });

    expect(eventPublisher.events).toHaveLength(1);
    const event = eventPublisher.events[0] as ReviewDeletedEvent;
    expect(event).toBeInstanceOf(ReviewDeletedEvent);
    expect(event.eventName).toBe('ReviewDeleted');
    expect(event.payload).toMatchObject({
      reviewId,
      restaurantId,
      reservationId,
      deletedBy: reviewOwnerUserId,
    });

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      actorId: reviewOwnerUserId,
      actorType: 'User',
      action: 'review.deleted',
    });
  });
});
