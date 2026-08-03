import { randomUUID } from 'crypto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ConversationId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import {
  ConversationStatus,
  MessageSenderType,
  MessageType,
} from '../../domain/enums/messaging.enums';
import {
  MessageCursor,
  MessagePage,
  MessageRepository,
} from '../../domain/repositories/message.repository';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import { UnsupportedMessageAttachmentFileTypeException } from '../../domain/exceptions/unsupported-message-attachment-file-type.exception';
import { InvalidMessageAttachmentFileException } from '../../domain/exceptions/invalid-message-attachment-file.exception';
import { ConversationAccessService } from '../services/conversation-access.service';
import { ConversationParticipantResolverService } from '../services/conversation-participant-resolver.service';
import { SendMessageUseCase } from './send-message.use-case';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';
const employeeId = '55555555-5555-4555-8555-555555555555';

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);

class InMemoryMessageRepository implements MessageRepository {
  public readonly created: Array<{ id: string; body: string }> = [];
  async create(message: import('../../domain/entities/message.entity').Message): Promise<void> {
    this.created.push({ id: message.messageId.value, body: message.body });
  }
  async findManyByConversationId(
    _conversationId: ConversationId,
    _after: MessageCursor | null,
    _limit: number,
  ): Promise<MessagePage> {
    return { items: [], hasMore: false };
  }
}

function customerActor(overrides: Partial<AuthenticatedUserActor> = {}): AuthenticatedUserActor {
  return {
    actorType: AccessTokenActorType.User,
    userId: customerUserId,
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    ...overrides,
  };
}

function employeeActor(
  overrides: Partial<AuthenticatedEmployeeActor> = {},
): AuthenticatedEmployeeActor {
  return {
    actorType: AccessTokenActorType.Employee,
    userId: 'employee-user-1',
    sessionId: 's1',
    sessionVersion: 1,
    tokenFamilyId: 'f1',
    employeeId,
    organizationId: 'org-1',
    restaurantId,
    branchIds: [],
    permissions: ['conversations:manage'],
    permissionsVersion: 1,
    ...overrides,
  };
}

async function build(overrides: { conversationStatus?: ConversationStatus } = {}) {
  const conversationParticipantRepository = new InMemoryConversationParticipantRepository();
  const conversationRepository = new InMemoryConversationRepository(
    conversationParticipantRepository,
  );
  const messageRepository = new InMemoryMessageRepository();

  const conversation = Conversation.reconstitute({
    id: conversationId,
    restaurantId,
    branchId,
    reservationId: null,
    subject: null,
    status: overrides.conversationStatus ?? ConversationStatus.Open,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await conversationRepository.create(conversation);
  await conversationParticipantRepository.create(
    ConversationParticipant.createCustomer({
      id: '66666666-6666-4666-8666-666666666666',
      conversationId,
      userId: customerUserId,
      now,
    }),
  );

  const restaurantRepository = {
    findById: async (id: RestaurantId) => ({
      organizationId: { value: 'org-1' },
      restaurantId: id,
    }),
  };

  const conversationAccess = new ConversationAccessService(
    conversationRepository,
    conversationParticipantRepository,
    restaurantRepository as never,
  );
  const participantResolver = new ConversationParticipantResolverService(
    conversationParticipantRepository,
    { now: () => now } as never,
    { generate: () => randomUUID() } as never,
  );

  const fileRepository = { create: jest.fn().mockResolvedValue(undefined) };
  const storagePort = { upload: jest.fn().mockResolvedValue(undefined), delete: jest.fn() };
  const events: unknown[] = [];
  const eventPublisher = {
    publish: jest.fn(async (e: unknown) => {
      events.push(e);
    }),
    publishAll: jest.fn(),
  };
  const unitOfWork = { execute: async <T>(work: () => Promise<T>) => work() };
  const idGenerator = { generate: () => randomUUID() };

  const useCase = new SendMessageUseCase(
    conversationRepository,
    messageRepository,
    fileRepository as never,
    storagePort as never,
    'private-bucket',
    { now: () => now } as never,
    idGenerator as never,
    eventPublisher as never,
    unitOfWork as never,
    conversationAccess,
    participantResolver,
  );

  return { useCase, conversationRepository, messageRepository, events, storagePort };
}

describe('SendMessageUseCase', () => {
  it('Customer sends a message successfully', async () => {
    const { useCase, messageRepository, events } = await build();

    const result = await useCase.execute({
      actor: customerActor(),
      conversationId,
      body: 'Is my table ready?',
    });

    expect(result.senderType).toBe(MessageSenderType.Customer);
    expect(messageRepository.created).toHaveLength(1);
    expect(events).toHaveLength(1);
  });

  it('Employee (Restaurant-side) sends a message successfully', async () => {
    const { useCase } = await build();

    const result = await useCase.execute({
      actor: employeeActor(),
      conversationId,
      body: 'Yes, right this way!',
    });

    expect(result.senderType).toBe(MessageSenderType.Employee);
    expect(result.senderEmployeeId).toBe(employeeId);
  });

  it('auto-reopens a Closed conversation when a new message is sent (D5)', async () => {
    const { useCase, conversationRepository } = await build({
      conversationStatus: ConversationStatus.Closed,
    });

    await useCase.execute({ actor: customerActor(), conversationId, body: 'Still there?' });

    const reloaded = await conversationRepository.findById(ConversationId.create(conversationId));
    expect(reloaded?.status).toBe(ConversationStatus.Open);
  });

  it('auto-reopens an Archived conversation when a new message is sent (D5)', async () => {
    const { useCase, conversationRepository } = await build({
      conversationStatus: ConversationStatus.Archived,
    });

    await useCase.execute({ actor: employeeActor(), conversationId, body: 'Following up' });

    const reloaded = await conversationRepository.findById(ConversationId.create(conversationId));
    expect(reloaded?.status).toBe(ConversationStatus.Open);
  });

  it('denies a Customer who is not a participant of the conversation (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor({ userId: '99999999-9999-4999-8999-999999999999' }),
        conversationId,
        body: 'Hello?',
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('uploads a valid PNG attachment and links it to the created Message (D7)', async () => {
    const { useCase, storagePort } = await build();

    const result = await useCase.execute({
      actor: customerActor(),
      conversationId,
      body: '',
      messageType: MessageType.Attachment,
      attachment: { buffer: PNG_SIGNATURE, mimeType: 'image/png', sizeBytes: PNG_SIGNATURE.length },
    });

    expect(result.attachmentFileId).not.toBeNull();
    expect(storagePort.upload).toHaveBeenCalledTimes(1);
  });

  it('rejects an attachment whose declared mimeType is not in the allow-list', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor(),
        conversationId,
        body: '',
        attachment: {
          buffer: Buffer.from('not-an-image'),
          mimeType: 'application/pdf',
          sizeBytes: 12,
        },
      }),
    ).rejects.toThrow(UnsupportedMessageAttachmentFileTypeException);
  });

  it('rejects an attachment whose magic bytes do not match the declared mimeType (spoofed Content-Type)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor(),
        conversationId,
        body: '',
        attachment: {
          buffer: Buffer.from('not-actually-a-png-but-claims-to-be'),
          mimeType: 'image/png',
          sizeBytes: 30,
        },
      }),
    ).rejects.toThrow(InvalidMessageAttachmentFileException);
  });
});
