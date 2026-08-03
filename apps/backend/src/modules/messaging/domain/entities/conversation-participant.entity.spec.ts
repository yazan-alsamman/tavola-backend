import { ConversationParticipant } from './conversation-participant.entity';
import { ConversationParticipantRole } from '../enums/messaging.enums';
import { InvalidConversationException } from '../exceptions/invalid-conversation.exception';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';

describe('ConversationParticipant', () => {
  it('createCustomer() sets role=Customer and userId, no employeeId', () => {
    const participant = ConversationParticipant.createCustomer({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      userId,
      now,
    });
    expect(participant.role).toBe(ConversationParticipantRole.Customer);
    expect(participant.userId?.value).toBe(userId);
    expect(participant.employeeId).toBeNull();
  });

  it('createStaff() with actorEmployeeId sets employeeId, no userId (D2)', () => {
    const participant = ConversationParticipant.createStaff({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      actorUserId: null,
      actorEmployeeId: employeeId,
      now,
    });
    expect(participant.role).toBe(ConversationParticipantRole.Staff);
    expect(participant.employeeId?.value).toBe(employeeId);
    expect(participant.userId).toBeNull();
  });

  it('createStaff() with actorUserId (OrganizationMember) sets userId, no employeeId (D2)', () => {
    const participant = ConversationParticipant.createStaff({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      actorUserId: userId,
      actorEmployeeId: null,
      now,
    });
    expect(participant.userId?.value).toBe(userId);
    expect(participant.employeeId).toBeNull();
  });

  it('createStaff() rejects both actorUserId and actorEmployeeId set', () => {
    expect(() =>
      ConversationParticipant.createStaff({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        actorUserId: userId,
        actorEmployeeId: employeeId,
        now,
      }),
    ).toThrow(InvalidConversationException);
  });

  it('createStaff() rejects neither actorUserId nor actorEmployeeId set', () => {
    expect(() =>
      ConversationParticipant.createStaff({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        actorUserId: null,
        actorEmployeeId: null,
        now,
      }),
    ).toThrow(InvalidConversationException);
  });

  it('markRead() sets lastReadAt', () => {
    const participant = ConversationParticipant.createCustomer({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      userId,
      now,
    });
    const readAt = new Date('2026-07-30T11:00:00.000Z');
    const read = participant.markRead(readAt);
    expect(read.lastReadAt).toEqual(readAt);
  });
});
