import { Conversation } from './conversation.entity';
import { ConversationStatus } from '../enums/messaging.enums';

const now = new Date('2026-07-30T10:00:00.000Z');
const restaurantId = '11111111-1111-4111-8111-111111111111';
const branchId = '22222222-2222-4222-8222-222222222222';

describe('Conversation', () => {
  it('starts Open with no lastMessageAt', () => {
    const conversation = Conversation.start({
      id: '33333333-3333-4333-8333-333333333333',
      restaurantId,
      branchId,
      reservationId: null,
      subject: null,
      now,
    });

    expect(conversation.status).toBe(ConversationStatus.Open);
    expect(conversation.lastMessageAt).toBeNull();
  });

  it('close() transitions to Closed (Restaurant-side, D5)', () => {
    const conversation = Conversation.start({
      id: '33333333-3333-4333-8333-333333333333',
      restaurantId,
      branchId,
      reservationId: null,
      subject: null,
      now,
    });
    const closed = conversation.close(new Date('2026-07-30T11:00:00.000Z'));
    expect(closed.status).toBe(ConversationStatus.Closed);
  });

  it('archive() transitions to Archived (Customer-only, D5/D11)', () => {
    const conversation = Conversation.start({
      id: '33333333-3333-4333-8333-333333333333',
      restaurantId,
      branchId,
      reservationId: null,
      subject: null,
      now,
    });
    const archived = conversation.archive(new Date('2026-07-30T11:00:00.000Z'));
    expect(archived.status).toBe(ConversationStatus.Archived);
  });

  it('recordMessageSent() auto-reopens a Closed conversation and stamps lastMessageAt (D5)', () => {
    const conversation = Conversation.start({
      id: '33333333-3333-4333-8333-333333333333',
      restaurantId,
      branchId,
      reservationId: null,
      subject: null,
      now,
    }).close(new Date('2026-07-30T11:00:00.000Z'));

    const messageAt = new Date('2026-07-30T12:00:00.000Z');
    const reopened = conversation.recordMessageSent(messageAt);

    expect(reopened.status).toBe(ConversationStatus.Open);
    expect(reopened.lastMessageAt).toEqual(messageAt);
  });

  it('recordMessageSent() auto-reopens an Archived conversation too (D5)', () => {
    const conversation = Conversation.start({
      id: '33333333-3333-4333-8333-333333333333',
      restaurantId,
      branchId,
      reservationId: null,
      subject: null,
      now,
    }).archive(new Date('2026-07-30T11:00:00.000Z'));

    const reopened = conversation.recordMessageSent(new Date('2026-07-30T12:00:00.000Z'));
    expect(reopened.status).toBe(ConversationStatus.Open);
  });

  it('supports a restaurant-wide conversation with no branchId (ADR-030)', () => {
    const conversation = Conversation.start({
      id: '33333333-3333-4333-8333-333333333333',
      restaurantId,
      branchId: null,
      reservationId: null,
      subject: null,
      now,
    });
    expect(conversation.branchId).toBeNull();
  });
});
