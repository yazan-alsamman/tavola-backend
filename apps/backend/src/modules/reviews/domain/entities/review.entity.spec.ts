import { Review } from './review.entity';
import { InvalidReviewException } from '../exceptions/invalid-review.exception';

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

  it('is immutable - no update method exists beyond softDelete', () => {
    const review = Review.create({ ...baseProps, rating: 4, comment: 'Nice' });
    // TypeScript itself enforces this at compile time (no updateXxx method
    // exists on the class); this assertion documents the invariant runtime-side.
    expect(Object.getOwnPropertyNames(Object.getPrototypeOf(review))).not.toContain('update');
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
