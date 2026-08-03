import { Offer } from './offer.entity';
import { OfferDiscountType, OfferStatus, OfferType } from '../enums/offer.enums';
import { InvalidOfferException } from '../exceptions/invalid-offer.exception';
import { InvalidOfferStatusTransitionException } from '../exceptions/invalid-offer-status-transition.exception';

describe('Offer entity', () => {
  const fixedNow = new Date('2026-08-01T10:00:00.000Z');
  const restaurantId = '33333333-3333-4333-8333-333333333333';

  function content(overrides?: Partial<Parameters<typeof Offer.create>[0]['content']>) {
    return {
      type: OfferType.Promotion,
      title: '20% Off Weekday Lunch',
      description: 'Enjoy 20% off any lunch entree.',
      discountType: OfferDiscountType.Percentage,
      discountValue: 20,
      startsAt: new Date('2026-08-01T00:00:00.000Z'),
      endsAt: new Date('2026-08-31T23:59:59.000Z'),
      ...overrides,
    };
  }

  function makeOffer(overrides?: Partial<Parameters<typeof Offer.create>[0]['content']>) {
    return Offer.create({
      id: '22222222-2222-4222-8222-222222222222',
      restaurantId,
      content: content(overrides),
      now: fixedNow,
    });
  }

  describe('create', () => {
    it('creates a Draft offer', () => {
      const offer = makeOffer();
      expect(offer.status).toBe(OfferStatus.Draft);
      expect(offer.type).toBe(OfferType.Promotion);
      expect(offer.discountValue).toBe(20);
      expect(offer.createdAt).toEqual(fixedNow);
      expect(offer.updatedAt).toEqual(fixedNow);
      expect(offer.deletedAt).toBeNull();
    });

    it('rejects an empty title', () => {
      expect(() => makeOffer({ title: '' })).toThrow(InvalidOfferException);
      expect(() => makeOffer({ title: '   ' })).toThrow(InvalidOfferException);
    });

    it('rejects a title over 200 characters', () => {
      expect(() => makeOffer({ title: 'a'.repeat(201) })).toThrow(InvalidOfferException);
    });

    it('rejects an empty description', () => {
      expect(() => makeOffer({ description: '' })).toThrow(InvalidOfferException);
    });

    it('rejects a Percentage discountValue of 0', () => {
      expect(() =>
        makeOffer({ discountType: OfferDiscountType.Percentage, discountValue: 0 }),
      ).toThrow(InvalidOfferException);
    });

    it('rejects a Percentage discountValue over 100', () => {
      expect(() =>
        makeOffer({ discountType: OfferDiscountType.Percentage, discountValue: 101 }),
      ).toThrow(InvalidOfferException);
    });

    it('accepts a Percentage discountValue of exactly 100', () => {
      expect(() =>
        makeOffer({ discountType: OfferDiscountType.Percentage, discountValue: 100 }),
      ).not.toThrow();
    });

    it('rejects a non-positive FixedAmount discountValue', () => {
      expect(() =>
        makeOffer({ discountType: OfferDiscountType.FixedAmount, discountValue: 0 }),
      ).toThrow(InvalidOfferException);
      expect(() =>
        makeOffer({ discountType: OfferDiscountType.FixedAmount, discountValue: -5 }),
      ).toThrow(InvalidOfferException);
    });

    it('accepts any positive FixedAmount discountValue', () => {
      expect(() =>
        makeOffer({ discountType: OfferDiscountType.FixedAmount, discountValue: 1000 }),
      ).not.toThrow();
    });

    it('rejects startsAt equal to endsAt', () => {
      const at = new Date('2026-08-10T00:00:00.000Z');
      expect(() => makeOffer({ startsAt: at, endsAt: at })).toThrow(InvalidOfferException);
    });

    it('rejects startsAt after endsAt', () => {
      expect(() =>
        makeOffer({
          startsAt: new Date('2026-08-31T00:00:00.000Z'),
          endsAt: new Date('2026-08-01T00:00:00.000Z'),
        }),
      ).toThrow(InvalidOfferException);
    });

    it('applies discount rules uniformly for Coupon and Event types (no type-specific branching)', () => {
      expect(() => makeOffer({ type: OfferType.Coupon })).not.toThrow();
      expect(() => makeOffer({ type: OfferType.Event })).not.toThrow();
    });
  });

  describe('update', () => {
    it('updates content while Draft', () => {
      const offer = makeOffer();
      const at = new Date('2026-08-02T00:00:00.000Z');
      const updated = offer.update(content({ title: 'New Title' }), at);
      expect(updated.title).toBe('New Title');
      expect(updated.status).toBe(OfferStatus.Draft);
      expect(updated.updatedAt).toEqual(at);
    });

    it('rejects updating a Published offer', () => {
      const offer = makeOffer();
      const published = offer.publish(fixedNow);
      expect(() => published.update(content(), fixedNow)).toThrow(
        InvalidOfferStatusTransitionException,
      );
    });

    it('rejects updating an Expired offer', () => {
      const offer = makeOffer();
      const published = offer.publish(fixedNow);
      const expired = published.expire(new Date('2026-09-01T00:00:00.000Z'));
      expect(() => expired.update(content(), fixedNow)).toThrow(
        InvalidOfferStatusTransitionException,
      );
    });

    it('re-validates content on update (e.g. rejects an empty title)', () => {
      const offer = makeOffer();
      expect(() => offer.update(content({ title: '' }), fixedNow)).toThrow(InvalidOfferException);
    });
  });

  describe('publish', () => {
    it('transitions Draft -> Published', () => {
      const offer = makeOffer();
      const published = offer.publish(fixedNow);
      expect(published.status).toBe(OfferStatus.Published);
    });

    it('rejects publishing a non-Draft offer', () => {
      const offer = makeOffer();
      const published = offer.publish(fixedNow);
      expect(() => published.publish(fixedNow)).toThrow(InvalidOfferStatusTransitionException);
    });

    it('rejects publishing when endsAt has already passed', () => {
      const offer = makeOffer({
        startsAt: new Date('2026-07-01T00:00:00.000Z'),
        endsAt: new Date('2026-07-31T00:00:00.000Z'),
      });
      expect(() => offer.publish(fixedNow)).toThrow(InvalidOfferException);
    });

    it('rejects publishing when endsAt equals now exactly', () => {
      const offer = makeOffer({
        startsAt: new Date('2026-07-01T00:00:00.000Z'),
        endsAt: fixedNow,
      });
      expect(() => offer.publish(fixedNow)).toThrow(InvalidOfferException);
    });
  });

  describe('expire', () => {
    it('transitions Published -> Expired', () => {
      const offer = makeOffer();
      const published = offer.publish(fixedNow);
      const expired = published.expire(new Date('2026-09-01T00:00:00.000Z'));
      expect(expired.status).toBe(OfferStatus.Expired);
    });

    it('rejects expiring a Draft offer', () => {
      const offer = makeOffer();
      expect(() => offer.expire(fixedNow)).toThrow(InvalidOfferStatusTransitionException);
    });

    it('rejects expiring an already-Expired offer (terminal)', () => {
      const offer = makeOffer();
      const published = offer.publish(fixedNow);
      const expired = published.expire(new Date('2026-09-01T00:00:00.000Z'));
      expect(() => expired.expire(new Date('2026-09-02T00:00:00.000Z'))).toThrow(
        InvalidOfferStatusTransitionException,
      );
    });
  });

  describe('softDelete', () => {
    it('soft-deletes from Draft', () => {
      const offer = makeOffer();
      const deleted = offer.softDelete(fixedNow);
      expect(deleted.isDeleted()).toBe(true);
      expect(deleted.deletedAt).toEqual(fixedNow);
    });

    it('soft-deletes from Published', () => {
      const offer = makeOffer().publish(fixedNow);
      const deleted = offer.softDelete(fixedNow);
      expect(deleted.isDeleted()).toBe(true);
      expect(deleted.status).toBe(OfferStatus.Published);
    });

    it('soft-deletes from Expired (terminal state remains soft-deletable)', () => {
      const offer = makeOffer().publish(fixedNow).expire(new Date('2026-09-01T00:00:00.000Z'));
      const deleted = offer.softDelete(new Date('2026-09-02T00:00:00.000Z'));
      expect(deleted.isDeleted()).toBe(true);
      expect(deleted.status).toBe(OfferStatus.Expired);
    });
  });

  describe('isPubliclyActive', () => {
    it('is false while Draft', () => {
      const offer = makeOffer();
      expect(offer.isPubliclyActive(new Date('2026-08-15T00:00:00.000Z'))).toBe(false);
    });

    it('is false before startsAt', () => {
      const offer = makeOffer().publish(fixedNow);
      expect(offer.isPubliclyActive(new Date('2026-07-31T23:59:59.999Z'))).toBe(false);
    });

    it('is true exactly at startsAt', () => {
      const offer = makeOffer().publish(fixedNow);
      expect(offer.isPubliclyActive(new Date('2026-08-01T00:00:00.000Z'))).toBe(true);
    });

    it('is true during the window', () => {
      const offer = makeOffer().publish(fixedNow);
      expect(offer.isPubliclyActive(new Date('2026-08-15T00:00:00.000Z'))).toBe(true);
    });

    it('is false exactly at endsAt (endsAt is exclusive)', () => {
      const offer = makeOffer().publish(fixedNow);
      expect(offer.isPubliclyActive(new Date('2026-08-31T23:59:59.000Z'))).toBe(false);
    });

    it('is false after endsAt, even if still marked Published (worker delay)', () => {
      const offer = makeOffer().publish(fixedNow);
      expect(offer.isPubliclyActive(new Date('2026-09-01T00:00:00.000Z'))).toBe(false);
    });

    it('is false once Expired', () => {
      const offer = makeOffer().publish(fixedNow).expire(new Date('2026-09-01T00:00:00.000Z'));
      expect(offer.isPubliclyActive(new Date('2026-08-15T00:00:00.000Z'))).toBe(false);
    });

    it('is false once soft-deleted, even while otherwise within the active window', () => {
      const offer = makeOffer().publish(fixedNow).softDelete(fixedNow);
      expect(offer.isPubliclyActive(new Date('2026-08-15T00:00:00.000Z'))).toBe(false);
    });
  });
});
