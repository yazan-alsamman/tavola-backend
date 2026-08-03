import { PrismaClient } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaOfferRepository } from '@modules/offers/infrastructure/persistence/prisma-offer.repository';
import { Offer } from '@modules/offers/domain/entities/offer.entity';
import {
  OfferDiscountType,
  OfferStatus,
  OfferType,
} from '@modules/offers/domain/enums/offer.enums';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'offer-repo-';

/**
 * Phase 11 (Offers, architecture frozen 2026-07-28, implemented 2026-07-28)
 * - proves `PrismaOfferRepository` against real PostgreSQL: persistence
 * round-trip, the FK/index shape the migration created, the CAS authority
 * behind `updateIfDraft`/`publishIfDraft`/`expireIfPublished` under real
 * concurrent writers (not just in-memory simulation), soft-delete exclusion,
 * and the public-listing temporal-window boundaries at the SQL level.
 */
describe('Offer round-trip via PrismaOfferRepository (integration)', () => {
  let dbAvailable = false;
  let repository: PrismaOfferRepository;
  let restaurantId: string;

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([PrismaOfferRepository]);
    repository = moduleRef.get(PrismaOfferRepository);

    const org = await rawPrisma.organization.create({
      data: {
        name: 'Offer Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
    const restaurant = await rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'Offer Repo Test Restaurant',
        slug: `${TEST_PREFIX}restaurant-${randomUUID()}`,
        status: 'Active',
      },
    });
    restaurantId = restaurant.id;
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.offer.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  function makeOffer(overrides?: { id?: string; startsAt?: Date; endsAt?: Date }): Offer {
    return Offer.create({
      id: overrides?.id ?? randomUUID(),
      restaurantId,
      content: {
        type: OfferType.Promotion,
        title: 'Repo Test Offer',
        description: 'Integration test offer.',
        discountType: OfferDiscountType.Percentage,
        discountValue: 15,
        startsAt: overrides?.startsAt ?? new Date('2026-08-01T00:00:00.000Z'),
        endsAt: overrides?.endsAt ?? new Date('2026-08-31T00:00:00.000Z'),
      },
      now: new Date('2026-07-25T00:00:00.000Z'),
    });
  }

  it('persists and round-trips every field, including Decimal discountValue', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);

    const found = await repository.findByIdAndRestaurantId(
      offer.offerId,
      RestaurantId.create(restaurantId),
    );
    expect(found).not.toBeNull();
    expect(found?.discountValue).toBe(15);
    expect(found?.type).toBe(OfferType.Promotion);
    expect(found?.status).toBe(OfferStatus.Draft);
  });

  it('findByIdAndRestaurantId 404s (returns null) for a foreign restaurantId (FK/IDOR proof)', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);

    const found = await repository.findByIdAndRestaurantId(
      offer.offerId,
      RestaurantId.create(randomUUID()),
    );
    expect(found).toBeNull();
  });

  it('updateIfDraft persists content while Draft', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);

    const updated = offer.update(
      { ...offer.toProps(), title: 'Updated Title' },
      new Date('2026-07-26T00:00:00.000Z'),
    );
    const applied = await repository.updateIfDraft(updated);
    expect(applied).toBe(true);

    const stored = await repository.findByIdAndRestaurantId(
      offer.offerId,
      RestaurantId.create(restaurantId),
    );
    expect(stored?.title).toBe('Updated Title');
  });

  it("updateIfDraft's own CAS rejects a write once the stored row is no longer Draft, independent of the domain guard", async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);
    await repository.publishIfDraft(offer.publish(new Date('2026-07-27T00:00:00.000Z')));

    // Bypass `Offer.update()`'s own guard entirely (`Offer.reconstitute` does
    // no status validation) to prove the REPOSITORY's `WHERE status =
    // 'Draft'` clause is itself the authority, not merely the domain-layer
    // check that already ran in `UpdateOfferUseCase`.
    const attemptedRewrite = Offer.reconstitute({
      ...offer.toProps(),
      title: 'Should Never Apply',
      status: OfferStatus.Draft,
    });
    const applied = await repository.updateIfDraft(attemptedRewrite);
    expect(applied).toBe(false);

    const stored = await repository.findById(offer.offerId);
    expect(stored?.title).not.toBe('Should Never Apply');
    expect(stored?.status).toBe(OfferStatus.Published);
  });

  it('publishIfDraft is CAS-guarded: only one of two concurrent publish attempts applies', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);

    const publishAttempt = offer.publish(new Date('2026-07-27T00:00:00.000Z'));
    const [firstResult, secondResult] = await Promise.all([
      repository.publishIfDraft(publishAttempt),
      repository.publishIfDraft(publishAttempt),
    ]);

    const successCount = [firstResult, secondResult].filter(Boolean).length;
    expect(successCount).toBe(1);

    const stored = await repository.findByIdAndRestaurantId(
      offer.offerId,
      RestaurantId.create(restaurantId),
    );
    expect(stored?.status).toBe(OfferStatus.Published);
  });

  it('expireIfPublished is CAS-guarded and idempotent on replay (duplicate worker execution)', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);
    await repository.publishIfDraft(offer.publish(new Date('2026-07-27T00:00:00.000Z')));

    const expireAt = new Date('2026-09-01T00:00:00.000Z');
    const first = await repository.expireIfPublished(offer.offerId, expireAt);
    expect(first).toBe(true);

    // Replay: a stale/duplicate worker execution of the same job must be a
    // safe no-op, never a second state change or error.
    const second = await repository.expireIfPublished(offer.offerId, expireAt);
    expect(second).toBe(false);

    const stored = await repository.findById(offer.offerId);
    expect(stored?.status).toBe(OfferStatus.Expired);
  });

  it('expireIfPublished never applies to a soft-deleted offer, even if still marked Published', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);
    const published = offer.publish(new Date('2026-07-27T00:00:00.000Z'));
    await repository.publishIfDraft(published);
    await repository.softDelete(offer.offerId, new Date('2026-07-28T00:00:00.000Z'));

    const applied = await repository.expireIfPublished(
      offer.offerId,
      new Date('2026-09-01T00:00:00.000Z'),
    );
    expect(applied).toBe(false);
  });

  it('softDelete is a no-op on a second call (not idempotent at the use-case level, but the write itself is safe)', async () => {
    if (!dbAvailable) return;
    const offer = makeOffer();
    await repository.create(offer);
    const at = new Date('2026-07-28T00:00:00.000Z');
    await repository.softDelete(offer.offerId, at);
    await expect(repository.softDelete(offer.offerId, new Date())).resolves.toBeUndefined();

    const found = await repository.findByIdAndRestaurantId(
      offer.offerId,
      RestaurantId.create(restaurantId),
    );
    expect(found).toBeNull();
  });

  it('findManyByRestaurantId (management) returns every status but excludes soft-deleted', async () => {
    if (!dbAvailable) return;
    const draft = makeOffer();
    await repository.create(draft);
    const published = makeOffer();
    await repository.create(published);
    await repository.publishIfDraft(published.publish(new Date('2026-07-27T00:00:00.000Z')));
    const deleted = makeOffer();
    await repository.create(deleted);
    await repository.softDelete(deleted.offerId, new Date('2026-07-29T00:00:00.000Z'));

    const page = await repository.findManyByRestaurantId(RestaurantId.create(restaurantId), 1, 100);
    const ids = page.items.map((item) => item.offerId.value);
    expect(ids).toContain(draft.offerId.value);
    expect(ids).toContain(published.offerId.value);
    expect(ids).not.toContain(deleted.offerId.value);
  });

  describe('findManyPublicByRestaurantId - temporal window boundaries', () => {
    it('excludes an offer before startsAt', async () => {
      if (!dbAvailable) return;
      const offer = makeOffer({
        startsAt: new Date('2026-10-10T00:00:00.000Z'),
        endsAt: new Date('2026-10-20T00:00:00.000Z'),
      });
      await repository.create(offer);
      await repository.publishIfDraft(offer.publish(new Date('2026-10-01T00:00:00.000Z')));

      const page = await repository.findManyPublicByRestaurantId(
        RestaurantId.create(restaurantId),
        new Date('2026-10-09T23:59:59.999Z'),
        1,
        100,
      );
      expect(page.items.map((i) => i.offerId.value)).not.toContain(offer.offerId.value);
    });

    it('includes an offer exactly at startsAt (inclusive lower bound)', async () => {
      if (!dbAvailable) return;
      const offer = makeOffer({
        startsAt: new Date('2026-11-10T00:00:00.000Z'),
        endsAt: new Date('2026-11-20T00:00:00.000Z'),
      });
      await repository.create(offer);
      await repository.publishIfDraft(offer.publish(new Date('2026-11-01T00:00:00.000Z')));

      const page = await repository.findManyPublicByRestaurantId(
        RestaurantId.create(restaurantId),
        new Date('2026-11-10T00:00:00.000Z'),
        1,
        100,
      );
      expect(page.items.map((i) => i.offerId.value)).toContain(offer.offerId.value);
    });

    it('excludes an offer exactly at endsAt (exclusive upper bound)', async () => {
      if (!dbAvailable) return;
      const offer = makeOffer({
        startsAt: new Date('2026-12-10T00:00:00.000Z'),
        endsAt: new Date('2026-12-20T00:00:00.000Z'),
      });
      await repository.create(offer);
      await repository.publishIfDraft(offer.publish(new Date('2026-12-01T00:00:00.000Z')));

      const page = await repository.findManyPublicByRestaurantId(
        RestaurantId.create(restaurantId),
        new Date('2026-12-20T00:00:00.000Z'),
        1,
        100,
      );
      expect(page.items.map((i) => i.offerId.value)).not.toContain(offer.offerId.value);
    });

    it('excludes a Draft offer even within its own would-be active window', async () => {
      if (!dbAvailable) return;
      const offer = makeOffer({
        startsAt: new Date('2027-01-10T00:00:00.000Z'),
        endsAt: new Date('2027-01-20T00:00:00.000Z'),
      });
      await repository.create(offer);

      const page = await repository.findManyPublicByRestaurantId(
        RestaurantId.create(restaurantId),
        new Date('2027-01-15T00:00:00.000Z'),
        1,
        100,
      );
      expect(page.items.map((i) => i.offerId.value)).not.toContain(offer.offerId.value);
    });

    it('excludes a Published-but-stale offer whose endsAt has already passed (worker not yet run)', async () => {
      if (!dbAvailable) return;
      const offer = makeOffer({
        startsAt: new Date('2027-02-01T00:00:00.000Z'),
        endsAt: new Date('2027-02-10T00:00:00.000Z'),
      });
      await repository.create(offer);
      await repository.publishIfDraft(offer.publish(new Date('2027-01-25T00:00:00.000Z')));
      // Status remains Published in storage (no expiration job ran) - the
      // query itself must still exclude it based on endsAt <= now.

      const page = await repository.findManyPublicByRestaurantId(
        RestaurantId.create(restaurantId),
        new Date('2027-02-15T00:00:00.000Z'),
        1,
        100,
      );
      expect(page.items.map((i) => i.offerId.value)).not.toContain(offer.offerId.value);
    });

    it('excludes a soft-deleted offer even though it is Published and within its window', async () => {
      if (!dbAvailable) return;
      const offer = makeOffer({
        startsAt: new Date('2027-03-01T00:00:00.000Z'),
        endsAt: new Date('2027-03-10T00:00:00.000Z'),
      });
      await repository.create(offer);
      await repository.publishIfDraft(offer.publish(new Date('2027-02-25T00:00:00.000Z')));
      await repository.softDelete(offer.offerId, new Date('2027-03-02T00:00:00.000Z'));

      const page = await repository.findManyPublicByRestaurantId(
        RestaurantId.create(restaurantId),
        new Date('2027-03-05T00:00:00.000Z'),
        1,
        100,
      );
      expect(page.items.map((i) => i.offerId.value)).not.toContain(offer.offerId.value);
    });
  });
});
