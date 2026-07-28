import { ReviewImage } from './review-image.entity';
import { InvalidReviewImageException } from '../exceptions/invalid-review-image.exception';

describe('ReviewImage', () => {
  const fixedNow = new Date('2026-07-26T12:00:00.000Z');
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    reviewId: '22222222-2222-4222-8222-222222222222',
    fileId: '33333333-3333-4333-8333-333333333333',
    sortOrder: 0,
    createdAt: fixedNow,
    deletedAt: null,
  };

  it('creates a valid image', () => {
    const image = ReviewImage.create(baseProps);
    expect(image.sortOrder).toBe(0);
    expect(image.isDeleted()).toBe(false);
  });

  it('rejects a negative sortOrder', () => {
    expect(() => ReviewImage.create({ ...baseProps, sortOrder: -1 })).toThrow(
      InvalidReviewImageException,
    );
  });

  it('rejects a non-integer sortOrder', () => {
    expect(() => ReviewImage.create({ ...baseProps, sortOrder: 1.5 })).toThrow(
      InvalidReviewImageException,
    );
  });

  it('softDelete sets deletedAt', () => {
    const image = ReviewImage.create(baseProps);
    const deletedAt = new Date('2026-07-27T00:00:00.000Z');
    const deleted = image.softDelete(deletedAt);
    expect(deleted.isDeleted()).toBe(true);
    expect(deleted.deletedAt).toEqual(deletedAt);
  });
});
