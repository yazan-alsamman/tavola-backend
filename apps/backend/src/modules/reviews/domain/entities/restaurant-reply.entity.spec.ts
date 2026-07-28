import { RestaurantReply } from './restaurant-reply.entity';
import { InvalidRestaurantReplyException } from '../exceptions/invalid-restaurant-reply.exception';

describe('RestaurantReply', () => {
  const fixedNow = new Date('2026-07-26T12:00:00.000Z');
  const baseProps = {
    id: '11111111-1111-4111-8111-111111111111',
    reviewId: '22222222-2222-4222-8222-222222222222',
    repliedByUserId: '33333333-3333-4333-8333-333333333333',
    comment: 'Thank you!',
    createdAt: fixedNow,
    updatedAt: fixedNow,
  };

  it('creates a valid reply', () => {
    const reply = RestaurantReply.create(baseProps);
    expect(reply.comment).toBe('Thank you!');
    expect(reply.repliedByUserId.value).toBe(baseProps.repliedByUserId);
  });

  it('rejects an empty comment', () => {
    expect(() => RestaurantReply.create({ ...baseProps, comment: '   ' })).toThrow(
      InvalidRestaurantReplyException,
    );
  });

  it('exposes no edit/delete method - immutable once created', () => {
    const reply = RestaurantReply.create(baseProps);
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(reply));
    expect(methods).not.toContain('update');
    expect(methods).not.toContain('softDelete');
    expect(methods).not.toContain('delete');
  });
});
