import { Restaurant } from '@modules/restaurants/domain/entities/restaurant.entity';
import { RestaurantStatus } from '@modules/restaurants/domain/enums/restaurant.enums';
import { RestaurantRepository } from '@modules/restaurants/domain/repositories/restaurant.repository';
import { RestaurantId } from '@shared/domain/value-objects/identifiers.vo';
import { Branch } from '@modules/branches/domain/entities/branch.entity';
import { Reservation } from '@modules/reservations/domain/entities/reservation.entity';
import {
  ReservationStatus,
  ReservationSource,
} from '@modules/reservations/domain/enums/reservation.enums';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import {
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { TenantContextService } from '@infrastructure/tenancy/tenant-context.service';
import { InMemoryBranchRepository } from '../../../../test/branches/support/in-memory-branch.repository';
import { InMemoryReservationRepository } from '../../../../test/reservations/support/in-memory-reservation.repository';
import { InMemoryConversationRepository } from '../../../../test/messaging/support/in-memory-conversation.repository';
import { InMemoryConversationParticipantRepository } from '../../../../test/messaging/support/in-memory-conversation-participant.repository';
import { Conversation } from '@modules/messaging/domain/entities/conversation.entity';
import { ConversationParticipant } from '@modules/messaging/domain/entities/conversation-participant.entity';
import { ConversationStatus } from '@modules/messaging/domain/enums/messaging.enums';
import { RoomAuthorizationService } from './room-authorization.service';
import { RoomType } from './room';

const now = new Date('2026-07-24T10:00:00.000Z');
const organizationId = '11111111-1111-4111-8111-111111111111';
const otherOrganizationId = '99999999-9999-4999-8999-999999999999';
const restaurantId = '22222222-2222-4222-8222-222222222222';
const branchId = '33333333-3333-4333-8333-333333333333';
const otherBranchId = '88888888-8888-4888-8888-888888888888';
const reservationId = '44444444-4444-4444-8444-444444444444';
const conversationId = '44444444-4444-4444-8444-444444444445';
const tableId = '55555555-5555-4555-8555-555555555555';
const userId = '66666666-6666-4666-8666-666666666666';
const employeeId = '77777777-7777-4777-8777-777777777777';
const malformedId = 'not-a-uuid';

/** Simulates the real Prisma tenant-scoping extension's `DIRECT_TENANT_OWNED_MODELS`
 * enforcement (TENANCY.md) for unit-testing cross-org denial without a real DB. */
class TenantScopedFakeRestaurantRepository implements RestaurantRepository {
  private readonly rows = new Map<string, Restaurant>();
  constructor(private readonly tenantContextService: TenantContextService) {}

  async findById(id: RestaurantId): Promise<Restaurant | null> {
    const boundOrgId = this.tenantContextService.getOrganizationId();
    if (boundOrgId === null) {
      throw new Error('TenantContextMissingException (fake)');
    }
    const restaurant = this.rows.get(id.value);
    if (!restaurant || restaurant.organizationId.value !== boundOrgId) {
      return null;
    }
    return restaurant;
  }

  async findByIdIncludingDeleted(id: RestaurantId): Promise<Restaurant | null> {
    return this.rows.get(id.value) ?? null;
  }

  async existsBySlug(): Promise<boolean> {
    return false;
  }

  async findMany() {
    return { items: [...this.rows.values()], total: this.rows.size };
  }

  async save(restaurant: Restaurant): Promise<void> {
    this.rows.set(restaurant.restaurantId.value, restaurant);
  }

  async recomputeAverageRating(): Promise<void> {
    // Not exercised by this spec - Reviews are outside room-authorization's
    // own scope.
  }

  async lockForRatingRecompute(): Promise<void> {
    // Not exercised by this spec - Reviews are outside room-authorization's
    // own scope.
  }

  async existsPubliclyById(id: RestaurantId): Promise<boolean> {
    return this.rows.has(id.value);
  }
}

function userActor(overrides: Partial<AuthenticatedUserActor> = {}): AuthenticatedUserActor {
  return {
    actorType: AccessTokenActorType.User,
    userId,
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    ...overrides,
  };
}

function employeeActor(
  overrides: Partial<AuthenticatedEmployeeActor> = {},
): AuthenticatedEmployeeActor {
  return {
    actorType: AccessTokenActorType.Employee,
    userId: 'employee-user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    employeeId,
    organizationId,
    restaurantId,
    branchIds: [],
    permissions: [],
    permissionsVersion: 1,
    ...overrides,
  };
}

function orgMemberActor(
  overrides: Partial<AuthenticatedOrganizationMemberActor> = {},
): AuthenticatedOrganizationMemberActor {
  return {
    actorType: AccessTokenActorType.OrganizationMember,
    userId: 'org-member-user-1',
    sessionId: 'session-1',
    sessionVersion: 1,
    tokenFamilyId: 'family-1',
    organizationId,
    orgRole: 'Owner',
    permissionsVersion: 1,
    ...overrides,
  };
}

async function build() {
  const tenantContextService = new TenantContextService();
  const restaurantRepository = new TenantScopedFakeRestaurantRepository(tenantContextService);
  const branchRepository = new InMemoryBranchRepository();
  const reservationRepository = new InMemoryReservationRepository();

  await restaurantRepository.save(
    Restaurant.create({
      id: restaurantId,
      organizationId,
      name: 'The Old Mill',
      slug: 'the-old-mill',
      logoId: null,
      coverImageId: null,
      description: null,
      cuisineType: null,
      averageRating: null,
      priceLevel: null,
      status: RestaurantStatus.Active,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  );
  await branchRepository.save(
    Branch.create({
      id: branchId,
      restaurantId,
      city: 'Damascus',
      district: null,
      address: '123 Main St',
      latitude: null,
      longitude: null,
      countryCode: 'SY',
      currency: null,
      timezone: 'Asia/Damascus',
      phone: null,
      createdAt: now,
      updatedAt: now,
      deletedAt: null,
    }),
  );

  const conversationParticipantRepository = new InMemoryConversationParticipantRepository();
  const conversationRepository = new InMemoryConversationRepository(
    conversationParticipantRepository,
  );

  const service = new RoomAuthorizationService(
    reservationRepository,
    branchRepository,
    restaurantRepository,
    conversationRepository,
    conversationParticipantRepository,
    tenantContextService,
  );

  return {
    service,
    reservationRepository,
    branchRepository,
    conversationRepository,
    conversationParticipantRepository,
  };
}

describe('RoomAuthorizationService', () => {
  describe('organization room', () => {
    it('denies Customer/User', async () => {
      const { service } = await build();
      expect(
        await service.authorize(userActor(), RoomType.Organization, organizationId),
      ).toBeNull();
    });

    it('denies Employee', async () => {
      const { service } = await build();
      expect(
        await service.authorize(employeeActor(), RoomType.Organization, organizationId),
      ).toBeNull();
    });

    it('allows OrganizationMember for their own organization', async () => {
      const { service } = await build();
      const room = await service.authorize(orgMemberActor(), RoomType.Organization, organizationId);
      expect(room).toBe(`organization:${organizationId}`);
    });

    it('denies OrganizationMember for a different organization', async () => {
      const { service } = await build();
      const room = await service.authorize(
        orgMemberActor(),
        RoomType.Organization,
        otherOrganizationId,
      );
      expect(room).toBeNull();
    });

    it('rejects a malformed organization id', async () => {
      const { service } = await build();
      expect(
        await service.authorize(orgMemberActor(), RoomType.Organization, malformedId),
      ).toBeNull();
    });
  });

  describe('restaurant room', () => {
    it('denies Customer/User', async () => {
      const { service } = await build();
      expect(await service.authorize(userActor(), RoomType.Restaurant, restaurantId)).toBeNull();
    });

    it('allows Employee scoped to that restaurant', async () => {
      const { service } = await build();
      const room = await service.authorize(employeeActor(), RoomType.Restaurant, restaurantId);
      expect(room).toBe(`restaurant:${restaurantId}`);
    });

    it('denies Employee scoped to a different restaurant', async () => {
      const { service } = await build();
      const room = await service.authorize(
        employeeActor({ restaurantId: 'other-restaurant-id' }),
        RoomType.Restaurant,
        restaurantId,
      );
      expect(room).toBeNull();
    });

    it('allows OrganizationMember when the restaurant belongs to their organization', async () => {
      const { service } = await build();
      const room = await service.authorize(orgMemberActor(), RoomType.Restaurant, restaurantId);
      expect(room).toBe(`restaurant:${restaurantId}`);
    });

    it('denies OrganizationMember when the restaurant belongs to a different organization (cross-org denial)', async () => {
      const { service } = await build();
      const room = await service.authorize(
        orgMemberActor({ organizationId: otherOrganizationId }),
        RoomType.Restaurant,
        restaurantId,
      );
      expect(room).toBeNull();
    });

    it('rejects a malformed restaurant id', async () => {
      const { service } = await build();
      expect(await service.authorize(employeeActor(), RoomType.Restaurant, malformedId)).toBeNull();
    });
  });

  describe('branch room', () => {
    it('denies Customer/User', async () => {
      const { service } = await build();
      expect(await service.authorize(userActor(), RoomType.Branch, branchId)).toBeNull();
    });

    it('allows a restaurant-wide Employee (empty branchIds) for a branch of their own restaurant', async () => {
      const { service } = await build();
      const room = await service.authorize(
        employeeActor({ branchIds: [] }),
        RoomType.Branch,
        branchId,
      );
      expect(room).toBe(`branch:${branchId}`);
    });

    it('allows a branch-scoped Employee assigned to that branch', async () => {
      const { service } = await build();
      const room = await service.authorize(
        employeeActor({ branchIds: [branchId] }),
        RoomType.Branch,
        branchId,
      );
      expect(room).toBe(`branch:${branchId}`);
    });

    it('denies a branch-scoped Employee not assigned to that branch (cross-branch denial)', async () => {
      const { service } = await build();
      const room = await service.authorize(
        employeeActor({ branchIds: [otherBranchId] }),
        RoomType.Branch,
        branchId,
      );
      expect(room).toBeNull();
    });

    it("denies an Employee whose restaurantId does not match the branch's restaurant", async () => {
      const { service } = await build();
      const room = await service.authorize(
        employeeActor({ restaurantId: 'other-restaurant-id', branchIds: [] }),
        RoomType.Branch,
        branchId,
      );
      expect(room).toBeNull();
    });

    it('allows OrganizationMember when the branch transitively belongs to their organization', async () => {
      const { service } = await build();
      const room = await service.authorize(orgMemberActor(), RoomType.Branch, branchId);
      expect(room).toBe(`branch:${branchId}`);
    });

    it('denies OrganizationMember when the branch belongs to a different organization', async () => {
      const { service } = await build();
      const room = await service.authorize(
        orgMemberActor({ organizationId: otherOrganizationId }),
        RoomType.Branch,
        branchId,
      );
      expect(room).toBeNull();
    });

    it('denies (does not throw) for an unknown branch id', async () => {
      const { service } = await build();
      const room = await service.authorize(
        employeeActor(),
        RoomType.Branch,
        '00000000-0000-4000-8000-000000000000',
      );
      expect(room).toBeNull();
    });
  });

  describe('reservation room', () => {
    function seedReservation(
      reservationRepository: InMemoryReservationRepository,
      overrides: Partial<{ userId: string | null; restaurantId: string; branchId: string }> = {},
    ) {
      const ownedByUser = overrides.userId === undefined ? userId : overrides.userId;
      const reservation = Reservation.reconstitute({
        id: reservationId,
        userId: ownedByUser,
        reservationGuestId: ownedByUser === null ? 'guest-1' : null,
        restaurantId: overrides.restaurantId ?? restaurantId,
        branchId: overrides.branchId ?? branchId,
        tableId,
        reservationDate: new Date('2026-07-25T00:00:00.000Z'),
        reservationStartTime: new Date('2026-07-25T19:00:00.000Z'),
        reservationEndTime: new Date('2026-07-25T21:00:00.000Z'),
        guests: 2,
        status: ReservationStatus.Pending,
        source: ownedByUser === null ? ReservationSource.Phone : ReservationSource.Online,
        notes: null,
        createdBy: ownedByUser,
        approvedBy: null,
        approvedAt: null,
        cancelledAt: null,
        completedAt: null,
        noShowAt: null,
        lateArrivalNotifiedAt: null,
        tableReadyNotifiedAt: null,
        rescheduledFromReservationId: null,
        createdAt: now,
        updatedAt: now,
      });
      reservationRepository.seed(reservation);
    }

    it('allows the owning Customer/User', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(userActor(), RoomType.Reservation, reservationId);
      expect(room).toBe(`reservation:${reservationId}`);
    });

    it('denies a non-owning Customer/User', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(
        userActor({ userId: 'someone-else' }),
        RoomType.Reservation,
        reservationId,
      );
      expect(room).toBeNull();
    });

    it('denies a Customer/User for a guest-backed reservation (userId null)', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId: null });

      const room = await service.authorize(userActor(), RoomType.Reservation, reservationId);
      expect(room).toBeNull();
    });

    it('allows a branch-scoped Employee for a reservation in their branch', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(
        employeeActor({ branchIds: [branchId] }),
        RoomType.Reservation,
        reservationId,
      );
      expect(room).toBe(`reservation:${reservationId}`);
    });

    it('denies an Employee scoped to a different branch (cross-branch denial)', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(
        employeeActor({ branchIds: [otherBranchId] }),
        RoomType.Reservation,
        reservationId,
      );
      expect(room).toBeNull();
    });

    it('denies an Employee from a different restaurant', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(
        employeeActor({ restaurantId: 'other-restaurant-id', branchIds: [] }),
        RoomType.Reservation,
        reservationId,
      );
      expect(room).toBeNull();
    });

    it('allows OrganizationMember when the reservation transitively belongs to their organization', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(orgMemberActor(), RoomType.Reservation, reservationId);
      expect(room).toBe(`reservation:${reservationId}`);
    });

    it('denies OrganizationMember from a different organization (cross-org denial)', async () => {
      const { service, reservationRepository } = await build();
      await seedReservation(reservationRepository, { userId });

      const room = await service.authorize(
        orgMemberActor({ organizationId: otherOrganizationId }),
        RoomType.Reservation,
        reservationId,
      );
      expect(room).toBeNull();
    });

    it('denies (does not throw, IDOR-safe) for an unknown reservation id', async () => {
      const { service } = await build();
      const room = await service.authorize(
        userActor(),
        RoomType.Reservation,
        '00000000-0000-4000-8000-000000000000',
      );
      expect(room).toBeNull();
    });

    it('rejects a malformed reservation id', async () => {
      const { service } = await build();
      expect(await service.authorize(userActor(), RoomType.Reservation, malformedId)).toBeNull();
    });
  });

  describe('conversation room (Phase 15.6, DECISIONS.md D9)', () => {
    async function seedConversation(
      conversationRepository: InMemoryConversationRepository,
      overrides: Partial<{ restaurantId: string; branchId: string | null }> = {},
    ) {
      const conversation = Conversation.reconstitute({
        id: conversationId,
        restaurantId: overrides.restaurantId ?? restaurantId,
        branchId: overrides.branchId === undefined ? branchId : overrides.branchId,
        reservationId: null,
        subject: null,
        status: ConversationStatus.Open,
        lastMessageAt: null,
        createdAt: now,
        updatedAt: now,
      });
      await conversationRepository.create(conversation);
    }

    async function seedCustomerParticipant(
      conversationParticipantRepository: InMemoryConversationParticipantRepository,
      customerUserId: string,
    ) {
      const participant = ConversationParticipant.createCustomer({
        id: '44444444-4444-4444-8444-444444444446',
        conversationId,
        userId: customerUserId,
        now,
      });
      await conversationParticipantRepository.create(participant);
    }

    it('allows the Customer participant', async () => {
      const { service, conversationRepository, conversationParticipantRepository } = await build();
      await seedConversation(conversationRepository);
      await seedCustomerParticipant(conversationParticipantRepository, userId);

      const room = await service.authorize(userActor(), RoomType.Conversation, conversationId);
      expect(room).toBe(`conversation:${conversationId}`);
    });

    it('denies a User who is not the Customer participant', async () => {
      const { service, conversationRepository, conversationParticipantRepository } = await build();
      await seedConversation(conversationRepository);
      await seedCustomerParticipant(conversationParticipantRepository, userId);

      const room = await service.authorize(
        userActor({ userId: 'someone-else' }),
        RoomType.Conversation,
        conversationId,
      );
      expect(room).toBeNull();
    });

    it('allows an Employee holding conversations:manage assigned to the conversation branch', async () => {
      const { service, conversationRepository } = await build();
      await seedConversation(conversationRepository);

      const room = await service.authorize(
        employeeActor({ branchIds: [branchId], permissions: ['conversations:manage'] }),
        RoomType.Conversation,
        conversationId,
      );
      expect(room).toBe(`conversation:${conversationId}`);
    });

    it('denies an Employee scoped to a different branch (cross-branch denial, D14)', async () => {
      const { service, conversationRepository } = await build();
      await seedConversation(conversationRepository);

      const room = await service.authorize(
        employeeActor({ branchIds: [otherBranchId], permissions: ['conversations:manage'] }),
        RoomType.Conversation,
        conversationId,
      );
      expect(room).toBeNull();
    });

    it('denies an Employee missing the conversations:manage permission', async () => {
      const { service, conversationRepository } = await build();
      await seedConversation(conversationRepository);

      const room = await service.authorize(
        employeeActor({ permissions: [] }),
        RoomType.Conversation,
        conversationId,
      );
      expect(room).toBeNull();
    });

    it('allows OrganizationMember Owner/Admin when the conversation transitively belongs to their organization', async () => {
      const { service, conversationRepository } = await build();
      await seedConversation(conversationRepository);

      const room = await service.authorize(orgMemberActor(), RoomType.Conversation, conversationId);
      expect(room).toBe(`conversation:${conversationId}`);
    });

    it('denies OrganizationMember from a different organization (cross-org denial, D14)', async () => {
      const { service, conversationRepository } = await build();
      await seedConversation(conversationRepository);

      const room = await service.authorize(
        orgMemberActor({ organizationId: otherOrganizationId }),
        RoomType.Conversation,
        conversationId,
      );
      expect(room).toBeNull();
    });

    it('allows Staff access to a restaurant-wide conversation (branchId null) regardless of branch restriction', async () => {
      const { service, conversationRepository } = await build();
      await seedConversation(conversationRepository, { branchId: null });

      const room = await service.authorize(
        employeeActor({ branchIds: [otherBranchId], permissions: ['conversations:manage'] }),
        RoomType.Conversation,
        conversationId,
      );
      expect(room).toBe(`conversation:${conversationId}`);
    });

    it('denies (does not throw, IDOR-safe) for an unknown conversation id', async () => {
      const { service } = await build();
      const room = await service.authorize(
        userActor(),
        RoomType.Conversation,
        '00000000-0000-4000-8000-000000000000',
      );
      expect(room).toBeNull();
    });

    it('rejects a malformed conversation id', async () => {
      const { service } = await build();
      expect(await service.authorize(userActor(), RoomType.Conversation, malformedId)).toBeNull();
    });
  });

  describe('user room (Phase 19.9, ADR-037)', () => {
    it('allows a User actor to join their own user room', async () => {
      const { service } = await build();
      const room = await service.authorize(userActor(), RoomType.User, userId);
      expect(room).toBe(`user:${userId}`);
    });

    it("denies a User actor for someone else's user room", async () => {
      const { service } = await build();
      const room = await service.authorize(userActor(), RoomType.User, otherOrganizationId);
      expect(room).toBeNull();
    });

    it('denies an Employee actor even for their own userId (no repository lookup, identity-only check)', async () => {
      const { service } = await build();
      const room = await service.authorize(employeeActor({ userId }), RoomType.User, userId);
      expect(room).toBeNull();
    });

    it('rejects a malformed user id', async () => {
      const { service } = await build();
      expect(await service.authorize(userActor(), RoomType.User, malformedId)).toBeNull();
    });
  });
});
