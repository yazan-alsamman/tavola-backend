import { Review } from './review.entity';
import { InvalidReviewException } from '../exceptions/invalid-review.exception';
import { ReviewNotReopenedException } from '../exceptions/review-not-reopened.exception';

describe('Review', () => {
  const fixedNow = new Date('2026-07-26T12:00:00.000Z');
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    userId: '22222222-2222-4222-8222-222222222222',
    restaurantId: '33333333-3333-4333-8333-333333333333',
    reservationId: '44444444-4444-4444-8444-444444444444',
    now: fixedNow,
  };

  it('creates a review with a valid rating and optional comment', () => {
    const review = Review.create({ ...baseProps, rating: 5, comment: 'Great!' });

    expect(review.rating).toBe(5);
    expect(review.comment).toBe('Great!');
    expect(review.isDeleted()).toBe(false);
    expect(review.createdAt).toEqual(fixedNow);
    expect(review.updatedAt).toEqual(fixedNow);
  });

  it('allows a rating-only review with no comment', () => {
    const review = Review.create({ ...baseProps, rating: 3, comment: null });
    expect(review.comment).toBeNull();
  });

  it.each([0, -1, 6, 100])('rejects rating %i as out of range', (rating) => {
    expect(() => Review.create({ ...baseProps, rating, comment: null })).toThrow(
      InvalidReviewException,
    );
  });

  it('rejects a non-integer rating', () => {
    expect(() => Review.create({ ...baseProps, rating: 4.5, comment: null })).toThrow(
      InvalidReviewException,
    );
  });

  it.each([1, 2, 3, 4, 5])('accepts rating %i', (rating) => {
    expect(() => Review.create({ ...baseProps, rating, comment: null })).not.toThrow();
  });

  it('has no free-form update: content changes only through reopen -> rerate', () => {
    const review = Review.create({ ...baseProps, rating: 4, comment: 'Nice' });
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(review))).not.toContain('update');
  });

  describe('three axes (ADR-045)', () => {
    const axes = {
      service: { rating: 5, comment: 'Quick' },
      place: { rating: 3, comment: null },
      food: { rating: 4, comment: 'Good' },
    };

    it('scores the plain average of the axes and keeps whole stars for app 1.0.2', () => {
      const review = Review.create({ ...baseProps, comment: null, axes });
      expect(review.score).toBe(4);
      expect(review.rating).toBe(4);
      expect(review.axes).toEqual(axes);
    });

    it('rounds the score to two decimals and the stars to the nearest whole', () => {
      const review = Review.create({
        ...baseProps,
        comment: null,
        axes: { ...axes, place: { rating: 4, comment: null }, food: { rating: 5, comment: null } },
      });
      expect(review.score).toBe(4.67);
      expect(review.rating).toBe(5);
    });

    it('scores a single-rating review as its rating', () => {
      const review = Review.create({ ...baseProps, rating: 3, comment: null });
      expect(review.score).toBe(3);
      expect(review.axes).toBeNull();
    });

    it.each([0, 6, 2.5])('rejects an axis rating of %p', (rating) => {
      expect(() =>
        Review.create({
          ...baseProps,
          comment: null,
          axes: { ...axes, food: { rating, comment: null } },
        }),
      ).toThrow(InvalidReviewException);
    });

    it('requires a rating when there are no axes', () => {
      expect(() => Review.create({ ...baseProps, comment: null })).toThrow(InvalidReviewException);
    });

    it('keeps the private note', () => {
      const review = Review.create({
        ...baseProps,
        rating: 2,
        comment: null,
        privateNote: 'Call me',
      });
      expect(review.privateNote).toBe('Call me');
    });
  });

  describe('re-rating (ADR-045)', () => {
    const openedAt = new Date('2026-07-28T09:00:00.000Z');
    const reratedAt = new Date('2026-07-29T09:00:00.000Z');

    it('refuses a re-rate the restaurant has not opened', () => {
      const review = Review.create({ ...baseProps, rating: 2, comment: null });
      expect(() => review.rerate({ rating: 5, comment: null }, reratedAt)).toThrow(
        ReviewNotReopenedException,
      );
    });

    it('opens once, then the new rating replaces the old one and closes the window', () => {
      const review = Review.create({ ...baseProps, rating: 2, comment: 'Slow' });
      const opened = review.reopen(openedAt);
      expect(opened.isOpenForRerating()).toBe(true);
      expect(opened.reopen(reratedAt).reopenedAt).toEqual(openedAt);

      const rerated = opened.rerate({ rating: 5, comment: 'Sorted out' }, reratedAt);
      expect(rerated.rating).toBe(5);
      expect(rerated.score).toBe(5);
      expect(rerated.comment).toBe('Sorted out');
      expect(rerated.isOpenForRerating()).toBe(false);
      expect(rerated.reratedAt).toEqual(reratedAt);
      expect(rerated.createdAt).toEqual(fixedNow);
    });
  });

  it('softDelete sets deletedAt and updatedAt, never rating/comment', () => {
    const review = Review.create({ ...baseProps, rating: 4, comment: 'Nice' });
    const deletedAt = new Date('2026-07-27T00:00:00.000Z');
    const deleted = review.softDelete(deletedAt);

    expect(deleted.isDeleted()).toBe(true);
    expect(deleted.deletedAt).toEqual(deletedAt);
    expect(deleted.updatedAt).toEqual(deletedAt);
    expect(deleted.rating).toBe(4);
    expect(deleted.comment).toBe('Nice');
  });

  it('reconstitute round-trips through toProps', () => {
    const review = Review.create({ ...baseProps, rating: 4, comment: 'Nice' });
    const restored = Review.reconstitute(review.toProps());
    expect(restored.toProps()).toEqual(review.toProps());
  });
});
