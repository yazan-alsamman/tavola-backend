import { Message } from './message.entity';
import { MessageSenderType, MessageType } from '../enums/messaging.enums';
import { InvalidMessageException } from '../exceptions/invalid-message.exception';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const employeeId = '33333333-3333-4333-8333-333333333333';

describe('Message', () => {
  it('Customer sender requires senderUserId, forbids senderEmployeeId', () => {
    const message = Message.create({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      senderType: MessageSenderType.Customer,
      senderUserId: userId,
      senderEmployeeId: null,
      body: 'Hello',
      now,
    });
    expect(message.senderUserId?.value).toBe(userId);
    expect(message.senderEmployeeId).toBeNull();
  });

  it('Employee sender requires senderEmployeeId (D3)', () => {
    const message = Message.create({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      senderType: MessageSenderType.Employee,
      senderUserId: null,
      senderEmployeeId: employeeId,
      body: 'On it!',
      now,
    });
    expect(message.senderEmployeeId?.value).toBe(employeeId);
  });

  it('OrganizationMember sender requires senderUserId, disambiguated from Customer by senderType (D3)', () => {
    const message = Message.create({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      senderType: MessageSenderType.OrganizationMember,
      senderUserId: userId,
      senderEmployeeId: null,
      body: 'Owner here',
      now,
    });
    expect(message.senderType).toBe(MessageSenderType.OrganizationMember);
    expect(message.senderUserId?.value).toBe(userId);
  });

  it('rejects a Customer message with senderEmployeeId set (both fields populated)', () => {
    expect(() =>
      Message.create({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        senderType: MessageSenderType.Customer,
        senderUserId: userId,
        senderEmployeeId: employeeId,
        body: 'Hello',
        now,
      }),
    ).toThrow(InvalidMessageException);
  });

  it('rejects a non-System message with neither senderUserId nor senderEmployeeId', () => {
    expect(() =>
      Message.create({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        senderType: MessageSenderType.Employee,
        senderUserId: null,
        senderEmployeeId: null,
        body: 'Hello',
        now,
      }),
    ).toThrow(InvalidMessageException);
  });

  it('System sender forbids both senderUserId and senderEmployeeId', () => {
    expect(() =>
      Message.create({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        senderType: MessageSenderType.System,
        senderUserId: userId,
        senderEmployeeId: null,
        body: 'System note',
        now,
      }),
    ).toThrow(InvalidMessageException);

    const systemMessage = Message.create({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      senderType: MessageSenderType.System,
      senderUserId: null,
      senderEmployeeId: null,
      body: 'System note',
      messageType: MessageType.System,
      now,
    });
    expect(systemMessage.senderType).toBe(MessageSenderType.System);
  });

  it('rejects an empty body for a Text message', () => {
    expect(() =>
      Message.create({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        senderType: MessageSenderType.Customer,
        senderUserId: userId,
        senderEmployeeId: null,
        body: '   ',
        now,
      }),
    ).toThrow(InvalidMessageException);
  });

  it('rejects a body exceeding the max length for a Text message', () => {
    expect(() =>
      Message.create({
        id: '44444444-4444-4444-8444-444444444444',
        conversationId,
        senderType: MessageSenderType.Customer,
        senderUserId: userId,
        senderEmployeeId: null,
        body: 'a'.repeat(4001),
        now,
      }),
    ).toThrow(InvalidMessageException);
  });

  it('anonymize() replaces body and stamps anonymizedAt (D10, GDPR)', () => {
    const message = Message.create({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      senderType: MessageSenderType.Customer,
      senderUserId: userId,
      senderEmployeeId: null,
      body: 'sensitive content',
      now,
    });
    const anonymizedAt = new Date('2026-08-01T00:00:00.000Z');
    const anonymized = message.anonymize(anonymizedAt);
    expect(anonymized.body).toBe('[removed]');
    expect(anonymized.anonymizedAt).toEqual(anonymizedAt);
  });

  it('accepts an attachment-only message with empty body for messageType Attachment', () => {
    const message = Message.create({
      id: '44444444-4444-4444-8444-444444444444',
      conversationId,
      senderType: MessageSenderType.Customer,
      senderUserId: userId,
      senderEmployeeId: null,
      body: '',
      messageType: MessageType.Attachment,
      attachmentFileId: '55555555-5555-4555-8555-555555555555',
      now,
    });
    expect(message.attachmentFileId?.value).toBe('55555555-5555-4555-8555-555555555555');
  });
});
