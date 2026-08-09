import { PrismaClient, Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { PrismaConversationRepository } from '@modules/messaging/infrastructure/persistence/prisma-conversation.repository';
import { PrismaConversationParticipantRepository } from '@modules/messaging/infrastructure/persistence/prisma-conversation-participant.repository';
import { PrismaMessageRepository } from '@modules/messaging/infrastructure/persistence/prisma-message.repository';
import { Conversation } from '@modules/messaging/domain/entities/conversation.entity';
import { ConversationParticipant } from '@modules/messaging/domain/entities/conversation-participant.entity';
import { Message } from '@modules/messaging/domain/entities/message.entity';
import { MessageSenderType } from '@modules/messaging/domain/enums/messaging.enums';
import { ConversationId, RestaurantId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { isDatabaseReachable, skipUnlessDatabaseAvailable } from '../support/live-database';
import { createPrismaIntegrationModule } from '../support/prisma-integration-testing';

/**
 * ADR-030 (D1): Conversation/ConversationParticipant/Message are NOT in
 * `withTenantScoping`'s `DIRECT_TENANT_OWNED_MODELS` - like
 * `prisma-branch.integration-spec.ts`, this spec deliberately does NOT bind
 * a tenant context around every call, and proves these repositories perform
 * no tenant filtering by themselves. Also proves the two raw-SQL invariants
 * (D2/D3) added in the Phase 15.6 migration are real database-level
 * constraints, not merely application-layer checks.
 */
const rawPrisma = new PrismaClient();
const TEST_PREFIX = 'messaging-repo-';

describe('Messaging repositories (integration)', () => {
  let dbAvailable = false;
  let conversationRepository: PrismaConversationRepository;
  let participantRepository: PrismaConversationParticipantRepository;
  let messageRepository: PrismaMessageRepository;
  let org: { id: string };

  beforeAll(async () => {
    dbAvailable = await isDatabaseReachable();
    if (skipUnlessDatabaseAvailable(dbAvailable)) {
      return;
    }

    const moduleRef = await createPrismaIntegrationModule([
      PrismaConversationRepository,
      PrismaConversationParticipantRepository,
      PrismaMessageRepository,
    ]);
    conversationRepository = moduleRef.get(PrismaConversationRepository);
    participantRepository = moduleRef.get(PrismaConversationParticipantRepository);
    messageRepository = moduleRef.get(PrismaMessageRepository);

    org = await rawPrisma.organization.create({
      data: {
        name: 'Messaging Repo Test Org',
        slug: `${TEST_PREFIX}org-${randomUUID()}`,
        billingEmail: `${TEST_PREFIX}@example.com`,
      },
    });
  });

  afterAll(async () => {
    if (!dbAvailable) return;
    await rawPrisma.message.deleteMany({
      where: { conversation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.conversationParticipant.deleteMany({
      where: { conversation: { restaurant: { slug: { startsWith: TEST_PREFIX } } } },
    });
    await rawPrisma.conversation.deleteMany({
      where: { restaurant: { slug: { startsWith: TEST_PREFIX } } },
    });
    await rawPrisma.user.deleteMany({ where: { email: { startsWith: TEST_PREFIX } } });
    await rawPrisma.restaurant.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.organization.deleteMany({ where: { slug: { startsWith: TEST_PREFIX } } });
    await rawPrisma.$disconnect();
  });

  async function createRestaurant(): Promise<{ id: string }> {
    return rawPrisma.restaurant.create({
      data: {
        organizationId: org.id,
        name: 'The Old Mill',
        slug: `${TEST_PREFIX}${randomUUID()}`,
        status: 'Active',
      },
    });
  }

  async function createBranch(restaurantId: string): Promise<{ id: string }> {
    return rawPrisma.branch.create({
      data: {
        restaurantId,
        city: 'Damascus',
        address: '123 Main St',
        countryCode: 'SY',
        timezone: 'Asia/Damascus',
      },
    });
  }

  async function createUser(): Promise<{ id: string }> {
    return rawPrisma.user.create({
      data: {
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        passwordHash: 'x',
        language: 'en',
        status: 'Active',
      },
    });
  }

  it('Conversation round-trips via create/update/findById with no organizationId column (ADR-030)', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const branch = await createBranch(restaurant.id);
    const now = new Date();

    const conversation = Conversation.start({
      id: randomUUID(),
      restaurantId: restaurant.id,
      branchId: branch.id,
      reservationId: null,
      subject: 'Table for 4',
      now,
    });
    await conversationRepository.create(conversation);

    const found = await conversationRepository.findById(conversation.conversationId);
    expect(found).not.toBeNull();
    expect(found?.restaurantId.value).toBe(restaurant.id);
    expect(found?.subject).toBe('Table for 4');

    const closed = found!.close(new Date());
    await conversationRepository.update(closed);
    const reloaded = await conversationRepository.findById(conversation.conversationId);
    expect(reloaded?.status).toBe('Closed');

    const row = await rawPrisma.conversation.findUnique({
      where: { id: conversation.conversationId.value },
    });
    expect(row).not.toBeNull();
    expect((row as unknown as Record<string, unknown>).organizationId).toBeUndefined();
  });

  it('does NOT filter by tenant context - findManyForRestaurant works with no bound TenantContext', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const conversation = Conversation.start({
      id: randomUUID(),
      restaurantId: restaurant.id,
      branchId: null,
      reservationId: null,
      subject: null,
      now: new Date(),
    });
    await conversationRepository.create(conversation);

    const page = await conversationRepository.findManyForRestaurant(
      RestaurantId.create(restaurant.id),
      null,
      null,
      50,
    );
    expect(page.items.map((c) => c.conversationId.value)).toContain(
      conversation.conversationId.value,
    );
  });

  it('D2: rejects a ConversationParticipant row with both userId and employeeId set (raw SQL CHECK)', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const branch = await createBranch(restaurant.id);
    const user = await createUser();
    const conversation = await rawPrisma.conversation.create({
      data: { restaurantId: restaurant.id, branchId: branch.id, status: 'Open' },
    });
    const employee = await seedEmployee(restaurant.id);

    await expect(
      rawPrisma.conversationParticipant.create({
        data: {
          conversationId: conversation.id,
          userId: user.id,
          employeeId: employee.id,
          role: 'Staff',
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });

  it('D2: rejects a ConversationParticipant row with neither userId nor employeeId set for a non-System role', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const conversation = await rawPrisma.conversation.create({
      data: { restaurantId: restaurant.id, status: 'Open' },
    });

    await expect(
      rawPrisma.conversationParticipant.create({
        data: { conversationId: conversation.id, role: 'Customer' },
      }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });

  it('D2: enforces at most one participant row per (conversationId, userId) via the partial unique index', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const user = await createUser();
    const conversation = await rawPrisma.conversation.create({
      data: { restaurantId: restaurant.id, status: 'Open' },
    });
    await rawPrisma.conversationParticipant.create({
      data: { conversationId: conversation.id, userId: user.id, role: 'Customer' },
    });

    await expect(
      rawPrisma.conversationParticipant.create({
        data: { conversationId: conversation.id, userId: user.id, role: 'Customer' },
      }),
    ).rejects.toThrow(Prisma.PrismaClientKnownRequestError);
  });

  it('D3: rejects a Message row with both senderUserId and senderEmployeeId set (raw SQL CHECK)', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const user = await createUser();
    const employee = await seedEmployee(restaurant.id);
    const conversation = await rawPrisma.conversation.create({
      data: { restaurantId: restaurant.id, status: 'Open' },
    });

    await expect(
      rawPrisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'Employee',
          senderUserId: user.id,
          senderEmployeeId: employee.id,
          body: 'hi',
          messageType: 'Text',
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });

  it('D3: rejects a non-System Message row with neither senderUserId nor senderEmployeeId', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const conversation = await rawPrisma.conversation.create({
      data: { restaurantId: restaurant.id, status: 'Open' },
    });

    await expect(
      rawPrisma.message.create({
        data: {
          conversationId: conversation.id,
          senderType: 'Customer',
          body: 'hi',
          messageType: 'Text',
        },
      }),
    ).rejects.toThrow(Prisma.PrismaClientUnknownRequestError);
  });

  it('D13: findManyByConversationId paginates newest-first by (createdAt, id) with a correct hasMore flag', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const user = await createUser();
    const conversation = Conversation.start({
      id: randomUUID(),
      restaurantId: restaurant.id,
      branchId: null,
      reservationId: null,
      subject: null,
      now: new Date(),
    });
    await conversationRepository.create(conversation);
    await participantRepository.create(
      ConversationParticipant.createCustomer({
        id: randomUUID(),
        conversationId: conversation.conversationId.value,
        userId: user.id,
        now: new Date(),
      }),
    );

    const baseTime = new Date('2026-07-30T10:00:00.000Z').getTime();
    for (let i = 0; i < 5; i += 1) {
      const message = Message.create({
        id: randomUUID(),
        conversationId: conversation.conversationId.value,
        senderType: MessageSenderType.Customer,
        senderUserId: user.id,
        senderEmployeeId: null,
        body: `message ${i}`,
        now: new Date(baseTime + i * 1000),
      });
      await messageRepository.create(message);
    }

    const firstPage = await messageRepository.findManyByConversationId(
      conversation.conversationId,
      null,
      3,
    );
    expect(firstPage.items).toHaveLength(3);
    expect(firstPage.items.map((m) => m.body)).toEqual(['message 4', 'message 3', 'message 2']);
    expect(firstPage.hasMore).toBe(true);

    const last = firstPage.items[firstPage.items.length - 1]!;
    const secondPage = await messageRepository.findManyByConversationId(
      conversation.conversationId,
      { createdAt: last.createdAt, id: last.messageId.value },
      3,
    );
    expect(secondPage.items.map((m) => m.body)).toEqual(['message 1', 'message 0']);
    expect(secondPage.hasMore).toBe(false);
  });

  it("anonymizeAllBySenderUserId (Phase 20.X, account deletion) replaces this sender's message bodies and sets anonymizedAt, leaving other senders in the same conversation untouched", async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const customer = await createUser();
    const employee = await seedEmployee(restaurant.id);
    const conversation = Conversation.start({
      id: randomUUID(),
      restaurantId: restaurant.id,
      branchId: null,
      reservationId: null,
      subject: null,
      now: new Date(),
    });
    await conversationRepository.create(conversation);

    const customerMessage = Message.create({
      id: randomUUID(),
      conversationId: conversation.conversationId.value,
      senderType: MessageSenderType.Customer,
      senderUserId: customer.id,
      senderEmployeeId: null,
      body: 'call me at 555-1234',
      now: new Date('2026-07-30T10:00:00.000Z'),
    });
    await messageRepository.create(customerMessage);

    const staffMessage = Message.create({
      id: randomUUID(),
      conversationId: conversation.conversationId.value,
      senderType: MessageSenderType.Employee,
      senderUserId: null,
      senderEmployeeId: employee.id,
      body: 'sure, see you at 7',
      now: new Date('2026-07-30T10:01:00.000Z'),
    });
    await messageRepository.create(staffMessage);

    const at = new Date('2026-09-06T12:00:00.000Z');
    await messageRepository.anonymizeAllBySenderUserId(UserId.create(customer.id), at);

    const anonymized = await rawPrisma.message.findUnique({
      where: { id: customerMessage.messageId.value },
    });
    expect(anonymized?.body).toBe('[removed]');
    expect(anonymized?.anonymizedAt).toEqual(at);

    const untouched = await rawPrisma.message.findUnique({
      where: { id: staffMessage.messageId.value },
    });
    expect(untouched?.body).toBe('sure, see you at 7');
    expect(untouched?.anonymizedAt).toBeNull();
  });

  it('anonymizeAllBySenderUserId is idempotent - re-running only matches rows still missing anonymizedAt', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const customer = await createUser();
    const conversation = Conversation.start({
      id: randomUUID(),
      restaurantId: restaurant.id,
      branchId: null,
      reservationId: null,
      subject: null,
      now: new Date(),
    });
    await conversationRepository.create(conversation);
    const message = Message.create({
      id: randomUUID(),
      conversationId: conversation.conversationId.value,
      senderType: MessageSenderType.Customer,
      senderUserId: customer.id,
      senderEmployeeId: null,
      body: 'original body',
      now: new Date('2026-07-30T10:00:00.000Z'),
    });
    await messageRepository.create(message);

    const firstAt = new Date('2026-09-06T12:00:00.000Z');
    await messageRepository.anonymizeAllBySenderUserId(UserId.create(customer.id), firstAt);
    const secondAt = new Date('2026-09-07T12:00:00.000Z');
    await messageRepository.anonymizeAllBySenderUserId(UserId.create(customer.id), secondAt);

    const row = await rawPrisma.message.findUnique({ where: { id: message.messageId.value } });
    expect(row?.anonymizedAt).toEqual(firstAt);
  });

  it('ConversationParticipant round-trips and findCustomerParticipant resolves the Customer row (D6 dependency)', async () => {
    if (!dbAvailable) return;
    const restaurant = await createRestaurant();
    const user = await createUser();
    const conversation = await rawPrisma.conversation.create({
      data: { restaurantId: restaurant.id, status: 'Open' },
    });
    await participantRepository.create(
      ConversationParticipant.createCustomer({
        id: randomUUID(),
        conversationId: conversation.id,
        userId: user.id,
        now: new Date(),
      }),
    );

    const found = await participantRepository.findCustomerParticipant(
      ConversationId.create(conversation.id),
    );
    expect(found?.userId?.value).toBe(user.id);

    const byUser = await participantRepository.findByConversationAndUser(
      ConversationId.create(conversation.id),
      UserId.create(user.id),
    );
    expect(byUser?.role).toBe('Customer');
  });

  async function seedEmployee(restaurantId: string): Promise<{ id: string }> {
    const role = await rawPrisma.role.upsert({
      where: { slug: `${TEST_PREFIX}role` },
      update: {},
      create: {
        name: 'Test Role',
        slug: `${TEST_PREFIX}role`,
        description: 'x',
        scope: 'Restaurant',
      },
    });
    return rawPrisma.employee.create({
      data: {
        restaurantId,
        roleId: role.id,
        firstName: 'Emma',
        lastName: 'Ployee',
        email: `${TEST_PREFIX}${randomUUID()}@example.com`,
        status: 'Active',
      },
    });
  }
});
