import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaReviewRepository } from '@modules/reviews/infrastructure/persistence/prisma-review.repository';
import { PrismaReviewImageRepository } from '@modules/reviews/infrastructure/persistence/prisma-review-image.repository';
import { PrismaRestaurantReplyRepository } from '@modules/reviews/infrastructure/persistence/prisma-restaurant-reply.repository';
import { PrismaRestaurantRepository } from '@modules/restaurants/infrastructure/persistence/prisma-restaurant.repository';
import { PrismaUnitOfWork } from '@modules/authentication/infrastructure/persistence/prisma-unit-of-work';
import { UnitOfWorkPort } from '@shared/application/ports/unit-of-work.port';
import { Review } from '@modules/reviews/domain/entities/review.entity';
import { ReviewImage } from '@modules/reviews/domain/entities/review-image.entity';
import { RestaurantReply } from '@modules/reviews/domain/entities/restaurant-reply.entity';
import { ReviewAlreadyExistsException } from '@modules/reviews/domain/exceptions/review-already-exists.exception';
import { ReviewAlreadyRepliedException } from '@modules/reviews/domain/exceptions/review-already-replied.exception';
import { RestaurantId, ReservationId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * Phase 10 (Reviews, architecture frozen 2026-07-26). `Review`/`ReviewImage`/
 * `RestaurantReply` carry no `organizationId` and are not in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` - no tenant context is
 * bound around any call here, mirroring
 * `prisma-restaurant-settings.integration-spec.ts`'s own precedent.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'review-repo-';

describe('Review/ReviewImage/RestaurantReply round-trip via Prisma repositories (integration)', () => {
  let dbAvailable = false;
  let reviewRepository: PrismaReviewRepository;
  let reviewImageRepository: PrismaReviewImageRepository;
  let restaurantReplyRepository: PrismaRestaurantReplyRepository;
  let restaurantRepository: PrismaRestaurantRepository;
  let unitOfWork: UnitOfWorkPort;
  let org: { id: string };
  let restaurant: { id: string };
  let branch: { id: string };
  let table: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaReviewRepository,
      PrismaReviewImageRepository,
      PrismaRestaurantReplyRepository,
      PrismaRestaurantRepository,
      PrismaUnitOfWork,
    ]);
    reviewRepository = moduleRef.get(PrismaReviewRepository);
    reviewImageRepository = moduleRef.get(PrismaReviewImageRepository);
    restaurantReplyRepository = moduleRef.get(PrismaRestaurantReplyRepository);
    restaurantRepository = moduleRef.get(PrismaRestaurantRepository);
    unitOfWork = moduleRef.get(PrismaUnitOfWork);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Review Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
    branch = await rawPrisma.branch.create({
      data: {
        restaurantId: restaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const floorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: branch.id, name: 'Main Floor', isActive: true },
    });
    table = await rawPrisma.table.create({
      data: { branchId: branch.id, floorPlanId: floorPlan.id, tableNumber: 'T1', capacity: 4 },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;

    await rawPrisma.restaurantReply.deleteMany({
      where: { review: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.reviewImage.deleteMany({
      where: { review: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.review.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.reservation.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.table.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.floorPlan.deleteMany({
      where: { branch: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.branch.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function seedUser(username?: string): Promise<{ id: string }> {
    return rawPrisma.user.create({
      data: {
        firstName: 'Test',
        lastName: 'Customer',
        email: `${TEST_PREFIX}user-${randomUUID()}@example.com`,
        username: username ?? null,
        passwordHash: 'argon2id$fake$not-used-by-this-spec',
        language: 'en',
      },
    });
  }

  // ADR-013's exclusion constraint rejects two overlapping Completed
  // reservations for the same table - each seeded reservation in this spec
  // must use its own non-overlapping time window.
  let reservationHourOffset = 0;
  function nextReservationWindow(): { start: Date; end: Date; date: Date } {
    reservationHourOffset += 3;
    const start = new Date(Date.UTC(2026, 6, 20, reservationHourOffset % 20, 0, 0));
    const end = new Date(start.getTime() + 2 * 60 * 60 * 1000);
    return { start, end, date: new Date('2026-07-20T00:00:00.000Z') };
  }

  async function seedCompletedReservation(userId: string): Promise<{ id: string }> {
    const window = nextReservationWindow();
    return rawPrisma.reservation.create({
      data: {
        userId,
        restaurantId: restaurant.id,
        branchId: branch.id,
        tableId: table.id,
        reservationDate: window.date,
        reservationStartTime: window.start,
        reservationEndTime: window.end,
        guests: 2,
        status: 'Completed',
        source: 'Online',
        createdBy: userId,
        completedAt: new Date(),
      },
    });
  }

  it('persists a Review via create() and rehydrates it via findById()', async () => {
    if (!dbAvailable) return;
    const user = await seedUser();
    const reservation = await seedCompletedReservation(user.id);

    const review = Review.create({
      id: randomUUID(),
      userId: user.id,
      restaurantId: restaurant.id,
      reservationId: reservation.id,
      rating: 5,
      comment: 'Wonderful evening.',
      now: new Date(),
    });
    await reviewRepository.create(review);

    const found = await reviewRepository.findById(review.reviewId);
    expect(found).not.toBeNull();
    expect(found?.rating).toBe(5);
    expect(found?.comment).toBe('Wonderful evening.');
    expect(found?.restaurantId.value).toBe(restaurant.id);
  });

  it('enforces UNIQUE(reservationId) at the database level - a losing concurrent insert throws ReviewAlreadyExistsException', async () => {
    if (!dbAvailable) return;
    const user = await seedUser();
    const reservation = await seedCompletedReservation(user.id);

    const reviewA = Review.create({
      id: randomUUID(),
      userId: user.id,
      restaurantId: restaurant.id,
      reservationId: reservation.id,
      rating: 5,
      comment: null,
      now: new Date(),
    });
    const reviewB = Review.create({
      id: randomUUID(),
      userId: user.id,
      restaurantId: restaurant.id,
      reservationId: reservation.id,
      rating: 3,
      comment: null,
      now: new Date(),
    });

    const results = await Promise.allSettled([
      reviewRepository.create(reviewA),
      reviewRepository.create(reviewB),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ReviewAlreadyExistsException,
    );
  });

  it('excludes soft-deleted reviews from findById/findByReservationId/list queries', async () => {
    if (!dbAvailable) return;
    const user = await seedUser();
    const reservation = await seedCompletedReservation(user.id);
    const review = Review.create({
      id: randomUUID(),
      userId: user.id,
      restaurantId: restaurant.id,
      reservationId: reservation.id,
      rating: 4,
      comment: null,
      now: new Date(),
    });
    await reviewRepository.create(review);
    await reviewRepository.softDelete(review.reviewId, new Date());

    expect(await reviewRepository.findById(review.reviewId)).toBeNull();
    expect(
      await reviewRepository.findByReservationId(ReservationId.create(reservation.id)),
    ).toBeNull();
    const page = await reviewRepository.findManyByRestaurantId(
      RestaurantId.create(restaurant.id),
      1,
      100,
    );
    expect(page.items.find((r) => r.reviewId.value === review.reviewId.value)).toBeUndefined();
  });

  it('ReviewImage: persists, lists ordered by sortOrder, and excludes soft-deleted rows', async () => {
    if (!dbAvailable) return;
    const user = await seedUser();
    const reservation = await seedCompletedReservation(user.id);
    const review = Review.create({
      id: randomUUID(),
      userId: user.id,
      restaurantId: restaurant.id,
      reservationId: reservation.id,
      rating: 5,
      comment: null,
      now: new Date(),
    });
    await reviewRepository.create(review);

    const file1 = await rawPrisma.file.create({
      data: {
        ownerId: review.reviewId.value,
        ownerType: 'Review',
        bucket: 'tavla-public',
        objectKey: `reviews/${review.reviewId.value}/images/1.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        accessPolicy: 'Public',
      },
    });
    const file2 = await rawPrisma.file.create({
      data: {
        ownerId: review.reviewId.value,
        ownerType: 'Review',
        bucket: 'tavla-public',
        objectKey: `reviews/${review.reviewId.value}/images/2.jpg`,
        mimeType: 'image/jpeg',
        sizeBytes: 100,
        accessPolicy: 'Public',
      },
    });

    const image1 = ReviewImage.create({
      id: randomUUID(),
      reviewId: review.reviewId.value,
      fileId: file1.id,
      sortOrder: 1,
      createdAt: new Date(),
      deletedAt: null,
    });
    const image2 = ReviewImage.create({
      id: randomUUID(),
      reviewId: review.reviewId.value,
      fileId: file2.id,
      sortOrder: 0,
      createdAt: new Date(),
      deletedAt: null,
    });
    await reviewImageRepository.create(image1);
    await reviewImageRepository.create(image2);

    const images = await reviewImageRepository.findManyByReviewId(review.reviewId);
    expect(images.map((i) => i.sortOrder)).toEqual([0, 1]);
    expect(await reviewImageRepository.countByReviewId(review.reviewId)).toBe(2);

    await reviewImageRepository.softDelete(image1.reviewImageId, new Date());
    expect(await reviewImageRepository.countByReviewId(review.reviewId)).toBe(1);
    expect(await reviewImageRepository.findById(image1.reviewImageId)).toBeNull();
  });

  it('RestaurantReply: persists and enforces UNIQUE(reviewId) at the database level', async () => {
    if (!dbAvailable) return;
    const user = await seedUser();
    const ownerUser = await seedUser();
    const reservation = await seedCompletedReservation(user.id);
    const review = Review.create({
      id: randomUUID(),
      userId: user.id,
      restaurantId: restaurant.id,
      reservationId: reservation.id,
      rating: 5,
      comment: null,
      now: new Date(),
    });
    await reviewRepository.create(review);

    const replyA = RestaurantReply.create({
      id: randomUUID(),
      reviewId: review.reviewId.value,
      repliedByUserId: ownerUser.id,
      comment: 'Thank you!',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const replyB = RestaurantReply.create({
      id: randomUUID(),
      reviewId: review.reviewId.value,
      repliedByUserId: ownerUser.id,
      comment: 'Second reply attempt',
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const results = await Promise.allSettled([
      restaurantReplyRepository.create(replyA),
      restaurantReplyRepository.create(replyB),
    ]);
    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(
      ReviewAlreadyRepliedException,
    );

    const found = await restaurantReplyRepository.findByReviewId(review.reviewId);
    expect(found).not.toBeNull();
  });

  it('rejects a rating outside 1-5 at the database CHECK constraint level', async () => {
    if (!dbAvailable) return;
    const user = await seedUser();
    const reservation = await seedCompletedReservation(user.id);

    await expect(
      rawPrisma.review.create({
        data: {
          userId: user.id,
          restaurantId: restaurant.id,
          reservationId: reservation.id,
          rating: 6,
        },
      }),
    ).rejects.toThrow();
  });

  it('recomputes Restaurant.averageRating transactionally after Review create/delete', async () => {
    if (!dbAvailable) return;
    const localRestaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Average Rating Test Restaurant',
        slug: `${TEST_PREFIX}avg-${randomUUID()}`,
        status: 'Active',
      },
    });
    const localBranch = await rawPrisma.branch.create({
      data: {
        restaurantId: localRestaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const localFloorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: localBranch.id, name: 'Main Floor', isActive: true },
    });
    const localTable = await rawPrisma.table.create({
      data: {
        branchId: localBranch.id,
        floorPlanId: localFloorPlan.id,
        tableNumber: 'T1',
        capacity: 4,
      },
    });

    let hourOffset = 0;
    async function seedReview(rating: number): Promise<string> {
      hourOffset += 3;
      const user = await seedUser();
      const reservation = await rawPrisma.reservation.create({
        data: {
          userId: user.id,
          restaurantId: localRestaurant.id,
          branchId: localBranch.id,
          tableId: localTable.id,
          reservationDate: new Date('2026-07-20T00:00:00.000Z'),
          reservationStartTime: new Date(Date.UTC(2026, 6, 20, hourOffset % 20, 0, 0)),
          reservationEndTime: new Date(Date.UTC(2026, 6, 20, (hourOffset % 20) + 2, 0, 0)),
          guests: 2,
          status: 'Completed',
          source: 'Online',
          createdBy: user.id,
          completedAt: new Date(),
        },
      });
      const review = await rawPrisma.review.create({
        data: {
          userId: user.id,
          restaurantId: localRestaurant.id,
          reservationId: reservation.id,
          rating,
        },
      });
      return review.id;
    }

    // Zero reviews -> null, never 0.
    let restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    expect(restaurantRow.averageRating).toBeNull();

    const review1Id = await seedReview(5);
    await restaurantRepository.recomputeAverageRating(
      RestaurantId.create(localRestaurant.id),
      new Date(),
    );
    restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    expect(restaurantRow.averageRating?.toNumber()).toBe(5);

    const review2Id = await seedReview(3);
    await restaurantRepository.recomputeAverageRating(
      RestaurantId.create(localRestaurant.id),
      new Date(),
    );
    restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    expect(restaurantRow.averageRating?.toNumber()).toBe(4);

    // Soft-delete one review - average must exclude it.
    await rawPrisma.review.update({ where: { id: review1Id }, data: { deletedAt: new Date() } });
    await restaurantRepository.recomputeAverageRating(
      RestaurantId.create(localRestaurant.id),
      new Date(),
    );
    restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    expect(restaurantRow.averageRating?.toNumber()).toBe(3);

    // Delete the last active review - back to null, never 0.
    await rawPrisma.review.update({ where: { id: review2Id }, data: { deletedAt: new Date() } });
    await restaurantRepository.recomputeAverageRating(
      RestaurantId.create(localRestaurant.id),
      new Date(),
    );
    restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    expect(restaurantRow.averageRating).toBeNull();
  });

  it('serializes concurrent averageRating recomputes for the same restaurant with no lost update', async () => {
    if (!dbAvailable) return;
    const localRestaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Concurrency Test Restaurant',
        slug: `${TEST_PREFIX}concurrency-${randomUUID()}`,
        status: 'Active',
      },
    });
    const localBranch = await rawPrisma.branch.create({
      data: {
        restaurantId: localRestaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const localFloorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: localBranch.id, name: 'Main Floor', isActive: true },
    });

    const ratings = [5, 4, 3, 2, 1];
    await Promise.all(
      ratings.map(async (rating, index) => {
        // Each rating gets its own Table so concurrent reservation inserts
        // never contend with ADR-013's exclusion constraint - this test's
        // concurrency target is `recomputeAverageRating`, not reservation
        // creation.
        const localTable = await rawPrisma.table.create({
          data: {
            branchId: localBranch.id,
            floorPlanId: localFloorPlan.id,
            tableNumber: `T${index}`,
            capacity: 4,
          },
        });
        const user = await seedUser();
        const reservation = await rawPrisma.reservation.create({
          data: {
            userId: user.id,
            restaurantId: localRestaurant.id,
            branchId: localBranch.id,
            tableId: localTable.id,
            reservationDate: new Date('2026-07-20T00:00:00.000Z'),
            reservationStartTime: new Date('2026-07-20T18:00:00.000Z'),
            reservationEndTime: new Date('2026-07-20T20:00:00.000Z'),
            guests: 2,
            status: 'Completed',
            source: 'Online',
            createdBy: user.id,
            completedAt: new Date(),
          },
        });
        await rawPrisma.review.create({
          data: {
            userId: user.id,
            restaurantId: localRestaurant.id,
            reservationId: reservation.id,
            rating,
          },
        });
      }),
    );

    // Fire every recompute concurrently. All 5 Review rows already exist and
    // are committed above, so this alone (recompute racing only itself, with
    // nothing racing the review INSERTs) cannot exercise the lost-update bug
    // fixed below - see the next test for that.
    await Promise.all(
      ratings.map(() =>
        restaurantRepository.recomputeAverageRating(
          RestaurantId.create(localRestaurant.id),
          new Date(),
        ),
      ),
    );

    const restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    // AVG(5,4,3,2,1) = 3.00
    expect(restaurantRow.averageRating?.toNumber()).toBe(3);
  });

  it('regression: concurrent Review INSERT + averageRating recompute (the real SubmitReviewUseCase shape) loses no update', async () => {
    // Bug found during Phase 10 live concurrency verification (see TASKS.md):
    // a bare `UPDATE restaurants SET average_rating = (SELECT AVG(...) ...)`
    // is NOT safe when it runs in the same transaction as the Review INSERT
    // that triggered it, under real concurrent writers - reproduced directly
    // against Postgres (5/8 trials silently dropped a concurrent Review from
    // the average, with all rows still correctly present in `reviews`).
    // `lockForRatingRecompute` (called BEFORE the insert, exactly as
    // `SubmitReviewUseCase` now does) fixes it. This test mirrors that exact
    // transaction shape - lock, then insert, then recompute - which the
    // preceding test does not (it inserts all rows before ever recomputing).
    if (!dbAvailable) return;
    const localRestaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Race Regression Restaurant',
        slug: `${TEST_PREFIX}race-${randomUUID()}`,
        status: 'Active',
      },
    });
    const localBranch = await rawPrisma.branch.create({
      data: {
        restaurantId: localRestaurant.id,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
    const localFloorPlan = await rawPrisma.floorPlan.create({
      data: { branchId: localBranch.id, name: 'Main Floor', isActive: true },
    });

    const ratings = [5, 4, 3, 2, 1];
    const reservationIds = await Promise.all(
      ratings.map(async (_rating, index) => {
        const localTable = await rawPrisma.table.create({
          data: {
            branchId: localBranch.id,
            floorPlanId: localFloorPlan.id,
            tableNumber: `RT${index}`,
            capacity: 4,
          },
        });
        const user = await seedUser();
        const reservation = await rawPrisma.reservation.create({
          data: {
            userId: user.id,
            restaurantId: localRestaurant.id,
            branchId: localBranch.id,
            tableId: localTable.id,
            reservationDate: new Date('2026-07-21T00:00:00.000Z'),
            reservationStartTime: new Date('2026-07-21T18:00:00.000Z'),
            reservationEndTime: new Date('2026-07-21T20:00:00.000Z'),
            guests: 2,
            status: 'Completed',
            source: 'Online',
            createdBy: user.id,
            completedAt: new Date(),
          },
        });
        return { reservationId: reservation.id, userId: user.id };
      }),
    );

    // Same transaction shape as SubmitReviewUseCase.execute: lock, then
    // insert the Review, then recompute - fired concurrently across all 5.
    await Promise.all(
      ratings.map((rating, index) =>
        unitOfWork.execute(async () => {
          await restaurantRepository.lockForRatingRecompute(
            RestaurantId.create(localRestaurant.id),
          );
          await reviewRepository.create(
            Review.create({
              id: randomUUID(),
              userId: reservationIds[index].userId,
              restaurantId: localRestaurant.id,
              reservationId: reservationIds[index].reservationId,
              rating,
              comment: null,
              now: new Date(),
            }),
          );
          await restaurantRepository.recomputeAverageRating(
            RestaurantId.create(localRestaurant.id),
            new Date(),
          );
        }),
      ),
    );

    const restaurantRow = await rawPrisma.restaurant.findUniqueOrThrow({
      where: { id: localRestaurant.id },
    });
    const reviewRows = await rawPrisma.review.findMany({
      where: { restaurantId: localRestaurant.id },
    });
    expect(reviewRows).toHaveLength(5);
    // AVG(5,4,3,2,1) = 3.00 - must reflect every concurrently-inserted row.
    expect(restaurantRow.averageRating?.toNumber()).toBe(3);
  });
});
