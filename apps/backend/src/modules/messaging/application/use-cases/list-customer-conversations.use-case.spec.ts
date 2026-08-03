import { randomUUID } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { MessagingConfig } from '@config/messaging.config';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { AuthenticatedUserActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { InMemoryConversationRepository } from '../../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '../../domain/entities/conversation.entity';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { ConversationStatus } from '../../domain/enums/messaging.enums';
import { decodeMessagingCursor } from '../services/messaging-cursor.util';
import { ListCustomerConversationsUseCase } from './list-customer-conversations.use-case';

const restaurantId = '22222222-2222-4222-8222-222222222222';
const customerUserId = '44444444-4444-4444-8444-444444444444';
const otherUserId = '99999999-9999-4999-8999-999999999999';

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

async function seedConversation(
  conversationRepository: InMemoryConversationRepository,
  conversationParticipantRepository: InMemoryConversationParticipantRepository,
  overrides: {
    id?: string;
    status?: ConversationStatus;
    updatedAt?: Date;
    userId?: string;
  } = {},
) {
  const id = overrides.id ?? randomUUID();
  const updatedAt = overrides.updatedAt ?? new Date('2026-07-30T10:00:00.000Z');
  const conversation = Conversation.reconstitute({
    id,
    restaurantId,
    branchId: null,
    reservationId: null,
    subject: null,
    status: overrides.status ?? ConversationStatus.Open,
    lastMessageAt: null,
    createdAt: updatedAt,
    updatedAt,
  });
  await conversationRepository.create(conversation);
  await conversationParticipantRepository.create(
    ConversationParticipant.createCustomer({
      id: randomUUID(),
      conversationId: id,
      userId: overrides.userId ?? customerUserId,
      now: updatedAt,
    }),
  );
  return conversation;
}

async function build(configOverrides: Partial<MessagingConfig['cursorPagination']> = {}) {
  const conversationParticipantRepository = new InMemoryConversationParticipantRepository();
  const conversationRepository = new InMemoryConversationRepository(
    conversationParticipantRepository,
  );
  const useCase = new ListCustomerConversationsUseCase(
    conversationRepository,
    fakeConfigService(configOverrides),
  );
  return { useCase, conversationRepository, conversationParticipantRepository };
}

describe('ListCustomerConversationsUseCase (D13 cursor pagination, D11 default-excludes-Archived)', () => {
  it("returns only the acting Customer's own conversations", async () => {
    const { useCase, conversationRepository, conversationParticipantRepository } = await build();
    await seedConversation(conversationRepository, conversationParticipantRepository, {
      userId: customerUserId,
    });
    await seedConversation(conversationRepository, conversationParticipantRepository, {
      userId: otherUserId,
    });

    const result = await useCase.execute({ actor: customerActor() });

    expect(result.items).toHaveLength(1);
  });

  it('excludes Archived conversations by default (D11)', async () => {
    const { useCase, conversationRepository, conversationParticipantRepository } = await build();
    await seedConversation(conversationRepository, conversationParticipantRepository, {
      status: ConversationStatus.Archived,
    });

    const result = await useCase.execute({ actor: customerActor() });

    expect(result.items).toHaveLength(0);
  });

  it('includes Archived conversations when includeArchived is true', async () => {
    const { useCase, conversationRepository, conversationParticipantRepository } = await build();
    await seedConversation(conversationRepository, conversationParticipantRepository, {
      status: ConversationStatus.Archived,
    });

    const result = await useCase.execute({ actor: customerActor(), includeArchived: true });

    expect(result.items).toHaveLength(1);
  });

  it('clamps a requested limit above the configured maxLimit', async () => {
    const { useCase, conversationRepository, conversationParticipantRepository } = await build({
      defaultLimit: 2,
      maxLimit: 2,
    });
    for (let i = 0; i < 3; i += 1) {
      await seedConversation(conversationRepository, conversationParticipantRepository, {
        updatedAt: new Date(2026, 6, 30, 10, i),
      });
    }

    const result = await useCase.execute({ actor: customerActor(), limit: 1000 });

    expect(result.items).toHaveLength(2);
    expect(result.nextCursor).not.toBeNull();
  });

  it('paginates via nextCursor without repeating or skipping items (D13 keyset bounds)', async () => {
    const { useCase, conversationRepository, conversationParticipantRepository } = await build({
      defaultLimit: 2,
      maxLimit: 2,
    });
    const created = [
      await seedConversation(conversationRepository, conversationParticipantRepository, {
        updatedAt: new Date('2026-07-30T10:00:00.000Z'),
      }),
      await seedConversation(conversationRepository, conversationParticipantRepository, {
        updatedAt: new Date('2026-07-30T10:01:00.000Z'),
      }),
      await seedConversation(conversationRepository, conversationParticipantRepository, {
        updatedAt: new Date('2026-07-30T10:02:00.000Z'),
      }),
    ];

    const firstPage = await useCase.execute({ actor: customerActor() });
    expect(firstPage.items).toHaveLength(2);
    expect(firstPage.nextCursor).not.toBeNull();

    const secondPage = await useCase.execute({
      actor: customerActor(),
      cursor: firstPage.nextCursor ?? undefined,
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.nextCursor).toBeNull();

    const allIds = [...firstPage.items, ...secondPage.items].map((item) => item.conversationId);
    expect(new Set(allIds).size).toBe(3);
    expect(allIds.sort()).toEqual(created.map((c) => c.conversationId.value).sort());
  });

  it('rejects a malformed cursor', async () => {
    const { useCase } = await build();

    await expect(
      useCase.execute({ actor: customerActor(), cursor: 'not-a-valid-cursor!!' }),
    ).rejects.toThrow();
  });

  it('the encoded nextCursor round-trips through decodeMessagingCursor', async () => {
    const { useCase, conversationRepository, conversationParticipantRepository } = await build({
      defaultLimit: 1,
      maxLimit: 1,
    });
    await seedConversation(conversationRepository, conversationParticipantRepository, {
      updatedAt: new Date('2026-07-30T10:00:00.000Z'),
    });
    await seedConversation(conversationRepository, conversationParticipantRepository, {
      updatedAt: new Date('2026-07-30T10:01:00.000Z'),
    });

    const result = await useCase.execute({ actor: customerActor() });

    expect(result.nextCursor).not.toBeNull();
    const decoded = decodeMessagingCursor(result.nextCursor as string);
    expect(decoded.id).toBe(result.items[0]?.conversationId);
  });
});
