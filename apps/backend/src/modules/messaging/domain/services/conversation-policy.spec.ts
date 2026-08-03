import { ConversationPolicy } from './conversation-policy';
import { ConversationParticipant } from '../entities/conversation-participant.entity';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const otherUserId = '33333333-3333-4333-8333-333333333333';
const employeeId = '44444444-4444-4444-8444-444444444444';

describe('ConversationPolicy.isCustomerParticipant', () => {
  it('returns false for a null participant (no row found)', () => {
    expect(ConversationPolicy.isCustomerParticipant(null, UserId.create(userId))).toBe(false);
  });

  it('returns true when the participant is the Customer role and userId matches', () => {
    const participant = ConversationParticipant.createCustomer({
      id: '55555555-5555-4555-8555-555555555555',
      conversationId,
      userId,
      now,
    });
    expect(ConversationPolicy.isCustomerParticipant(participant, UserId.create(userId))).toBe(true);
  });

  it('returns false when userId does not match the Customer participant', () => {
    const participant = ConversationParticipant.createCustomer({
      id: '55555555-5555-4555-8555-555555555555',
      conversationId,
      userId,
      now,
    });
    expect(ConversationPolicy.isCustomerParticipant(participant, UserId.create(otherUserId))).toBe(
      false,
    );
  });

  it('returns false for a Staff participant even if userId matches (OrganizationMember staff row)', () => {
    const participant = ConversationParticipant.createStaff({
      id: '55555555-5555-4555-8555-555555555555',
      conversationId,
      actorUserId: userId,
      actorEmployeeId: null,
      now,
    });
    expect(ConversationPolicy.isCustomerParticipant(participant, UserId.create(userId))).toBe(
      false,
    );
  });

  it('returns false for an Employee Staff participant (no userId at all)', () => {
    const participant = ConversationParticipant.createStaff({
      id: '55555555-5555-4555-8555-555555555555',
      conversationId,
      actorUserId: null,
      actorEmployeeId: employeeId,
      now,
    });
    expect(ConversationPolicy.isCustomerParticipant(participant, UserId.create(userId))).toBe(
      false,
    );
  });
});
