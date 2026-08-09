import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { MessagingConfig } from '@config/messaging.config';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedUserActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { ConversationId, RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { Message } from '../../domain/entities/message.entity';
import { ConversationStatus, MessageSenderType } from '../../domain/enums/messaging.enums';
import { ConversationNotFoundException } from '../../domain/exceptions/conversation-not-found.exception';
import {
  MessageCursor,
  MessagePage,
  MessageRepository,
} from '../../domain/repositories/message.repository';
import { ConversationAccessService } from '../services/conversation-access.service';
import { decodeMessagingCursor } from '../services/messaging-cursor.util';
import { ListMessagesUseCase } from './list-messages.use-case';

const now = new Date('2026-07-30T10:00:00.000Z');
const conversationId = '11111111-1111-4111-8111-111111111111';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const customerUserId = '44444444-4444-4444-8444-444444444444';

class InMemoryMessageRepository implements MessageRepository {
  private readonly rows: Message[] = [];

  async create(message: Message): Promise<void> {
    this.rows.push(message);
  }

  async findManyByConversationId(
    conversationIdArg: ConversationId,
    after: MessageCursor | null,
    limit: number,
  ): Promise<MessagePage> {
    const sorted = [...this.rows]
      .filter((m) => m.conversationId.value === conversationIdArg.value)
      .sort((a, b) => {
        const diff = b.createdAt.getTime() - a.createdAt.getTime();
        return diff !== 0 ? diff : b.messageId.value.localeCompare(a.messageId.value);
      });
    const filtered = after
      ? sorted.filter((m) => {
          if (m.createdAt.getTime() !== after.createdAt.getTime()) {
            return m.createdAt.getTime() < after.createdAt.getTime();
          }
          return m.messageId.value < after.id;
        })
      : sorted;
    const hasMore = filtered.length > limit;
    return { items: filtered.slice(0, limit), hasMore };
  }

  async anonymizeAllBySenderUserId(): Promise<void> {
    throw new Error('Not needed by this suite.');
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

function fakeConfigService(
  overrides: Partial<MessagingConfig['cursorPagination']> = {},
): ConfigService {
  const config: MessagingConfig = {
    sendRateLimit: { max: 30, windowSeconds: 60 },
    cursorPagination: { defaultLimit: 50, maxLimit: 100, ...overrides },
    idempotency: { ttlSeconds: 86400 },
  };
  return { get: () => config } as unknown as ConfigService;
}

function makeMessage(overrides: { id?: string; createdAt?: Date; body?: string } = {}): Message {
  return Message.create({
    id: overrides.id ?? randomUUID(),
    conversationId,
    senderType: MessageSenderType.Customer,
    senderUserId: customerUserId,
    senderEmployeeId: null,
    body: overrides.body ?? 'Hi',
    now: overrides.createdAt ?? now,
  });
}

async function build(configOverrides: Partial<MessagingConfig['cursorPagination']> = {}) {
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
    status: ConversationStatus.Open,
    lastMessageAt: null,
    createdAt: now,
    updatedAt: now,
  });
  await conversationRepository.create(conversation);
  await conversationParticipantRepository.create(
    ConversationParticipant.createCustomer({
      id: randomUUID(),
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

  const useCase = new ListMessagesUseCase(
    messageRepository,
    conversationAccess,
    fakeConfigService(configOverrides),
  );

  return { useCase, messageRepository };
}

describe('ListMessagesUseCase (D13 cursor pagination)', () => {
  it('returns the messages of an authorized conversation, newest first', async () => {
    const { useCase, messageRepository } = await build();
    await messageRepository.create(
      makeMessage({ createdAt: new Date('2026-07-30T10:00:00.000Z'), body: 'first' }),
    );
    await messageRepository.create(
      makeMessage({ createdAt: new Date('2026-07-30T10:01:00.000Z'), body: 'second' }),
    );

    const result = await useCase.execute({ actor: customerActor(), conversationId });

    expect(result.items).toHaveLength(2);
    expect(result.items[0]?.body).toBe('second');
    expect(result.items[1]?.body).toBe('first');
  });

  it('denies a Customer who is not a participant of the conversation (IDOR-safe, D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor({ userId: '99999999-9999-4999-8999-999999999999' }),
        conversationId,
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('collapses an unknown conversationId to the same 404 (D14)', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({
        actor: customerActor(),
        conversationId: '66666666-6666-4666-8666-666666666666',
      }),
    ).rejects.toThrow(ConversationNotFoundException);
  });

  it('clamps a requested limit above the configured maxLimit', async () => {
    const { useCase, messageRepository } = await build({ defaultLimit: 2, maxLimit: 2 });
    for (let i = 0; i < 3; i += 1) {
      await messageRepository.create(makeMessage({ createdAt: new Date(2026, 6, 30, 10, i) }));
    }

    const result = await useCase.execute({ actor: customerActor(), conversationId, limit: 1000 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it('paginates via nextCursor without repeating or skipping items (D13 keyset bounds)', async () => {
    const { useCase, messageRepository } = await build({ defaultLimit: 2, maxLimit: 2 });
    const ids = ['a', 'b', 'c'].map(() => randomUUID());
    await messageRepository.create(
      makeMessage({ id: ids[0], createdAt: new Date('2026-07-30T10:00:00.000Z') }),
    );
    await messageRepository.create(
      makeMessage({ id: ids[1], createdAt: new Date('2026-07-30T10:01:00.000Z') }),
    );
    await messageRepository.create(
      makeMessage({ id: ids[2], createdAt: new Date('2026-07-30T10:02:00.000Z') }),
    );

    const firstPage = await useCase.execute({ actor: customerActor(), conversationId });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await useCase.execute({
      actor: customerActor(),
      conversationId,
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = [...firstPage.items, ...secondPage.items].map((item) => item.messageId).sort();
    expect(allIds).toEqual([...ids].sort());
  });

  it('rejects a malformed cursor', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: customerActor(), conversationId, cursor: '!!not-valid' }),
    ).rejects.toThrow();
  });

  it('the encoded nextCursor round-trips through decodeMessagingCursor', async () => {
    const { useCase, messageRepository } = await build({ defaultLimit: 1, maxLimit: 1 });
    await messageRepository.create(
      makeMessage({ createdAt: new Date('2026-07-30T10:00:00.000Z') }),
    );
    await messageRepository.create(
      makeMessage({ createdAt: new Date('2026-07-30T10:01:00.000Z') }),
    );

    const result = await useCase.execute({ actor: customerActor(), conversationId });

    expect(result.nextCursor).not.toBeNull();
    const decoded = decodeMessagingCursor(result.nextCursor as string);
    expect(decoded.id).toBe(result.items[0]?.messageId);
  });
});
