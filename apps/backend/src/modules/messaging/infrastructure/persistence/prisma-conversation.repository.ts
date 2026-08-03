import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import {
  BranchId,
  ConversationId,
  RestaurantId,
  UserId,
} from '@shared/domain/value-objects/identifiers.vo';
import { Conversation } from '../../domain/entities/conversation.entity';
import {
  ConversationCursor,
  ConversationPage,
  ConversationRepository,
} from '../../domain/repositories/conversation.repository';
import { ConversationPrismaMapper } from './conversation.prisma-mapper';

/**
 * ADR-030 - `Conversation` is NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (no direct `organizationId` column), so
 * queries here run through the tenant-scoped `PrismaContext` client as a
 * verified no-op passthrough, exactly like `PrismaBranchRepository`. This
 * repository provides NO tenant isolation by itself - every consuming use
 * case MUST resolve the parent `Restaurant`/actor tenancy first (see
 * `ConversationAccessService`/`assertActorCanManageConversation`).
 */
@Injectable()
export class PrismaConversationRepository implements ConversationRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: ConversationId): Promise<Conversation | null> {
    const row = await this.prismaContext.client.conversation.findFirst({
      where: { id: id.value, deletedAt: null },
    });
    return row ? ConversationPrismaMapper.toDomain(row) : null;
  }

  async create(conversation: Conversation): Promise<void> {
    const data = ConversationPrismaMapper.toPersistence(conversation);
    await this.prismaContext.client.conversation.create({ data });
  }

  async update(conversation: Conversation): Promise<void> {
    const data = ConversationPrismaMapper.toPersistence(conversation);
    await this.prismaContext.client.conversation.update({
      where: { id: data.id },
      data: {
        subject: data.subject,
        status: data.status,
        lastMessageAt: data.lastMessageAt,
        updatedAt: data.updatedAt,
      },
    });
  }

  async findManyForCustomer(
    userId: UserId,
    includeArchived: boolean,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationPage> {
    const where: Prisma.ConversationWhereInput = {
      deletedAt: null,
      participants: { some: { userId: userId.value, role: 'Customer' } },
      ...(includeArchived ? {} : { status: { not: 'Archived' } }),
      ...keysetWhere(after),
    };
    return this.queryPage(where, limit);
  }

  async findManyForRestaurant(
    restaurantId: RestaurantId,
    restrictToBranchIds: BranchId[] | null,
    after: ConversationCursor | null,
    limit: number,
  ): Promise<ConversationPage> {
    const where: Prisma.ConversationWhereInput = {
      deletedAt: null,
      restaurantId: restaurantId.value,
      ...(restrictToBranchIds
        ? {
            OR: [{ branchId: null }, { branchId: { in: restrictToBranchIds.map((b) => b.value) } }],
          }
        : {}),
      ...keysetWhere(after),
    };
    return this.queryPage(where, limit);
  }

  private async queryPage(
    where: Prisma.ConversationWhereInput,
    limit: number,
  ): Promise<ConversationPage> {
    const rows = await this.prismaContext.client.conversation.findMany({
      where,
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });
    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(ConversationPrismaMapper.toDomain);
    return { items, hasMore };
  }
}

/**
 * Keyset (D13): `(updatedAt, id)` strictly less than the cursor, matching
 * the `orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }]` above - a compound
 * comparison Prisma's native single-column `cursor` option cannot express,
 * so it is built as an explicit `OR` instead (the same technique
 * `PrismaMessageRepository` uses for `(createdAt, id)`).
 */
function keysetWhere(after: ConversationCursor | null): Prisma.ConversationWhereInput {
  if (after === null) {
    return {};
  }
  return {
    OR: [
      { updatedAt: { lt: after.updatedAt } },
      { updatedAt: after.updatedAt, id: { lt: after.id } },
    ],
  };
}
