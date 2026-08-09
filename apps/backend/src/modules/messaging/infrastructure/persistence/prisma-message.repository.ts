import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ConversationId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { Message } from '../../domain/entities/message.entity';
import {
  MessageCursor,
  MessagePage,
  MessageRepository,
} from '../../domain/repositories/message.repository';
import { MessagePrismaMapper } from './message.prisma-mapper';

@Injectable()
export class PrismaMessageRepository implements MessageRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async create(message: Message): Promise<void> {
    const data = MessagePrismaMapper.toPersistence(message);
    await this.prismaContext.client.message.create({ data });
  }

  async findManyByConversationId(
    conversationId: ConversationId,
    after: MessageCursor | null,
    limit: number,
  ): Promise<MessagePage> {
    const where: Prisma.MessageWhereInput = {
      conversationId: conversationId.value,
      deletedAt: null,
      ...(after
        ? {
            OR: [
              { createdAt: { lt: after.createdAt } },
              { createdAt: after.createdAt, id: { lt: after.id } },
            ],
          }
        : {}),
    };

    const rows = await this.prismaContext.client.message.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
    });

    const hasMore = rows.length > limit;
    const items = rows.slice(0, limit).map(MessagePrismaMapper.toDomain);
    return { items, hasMore };
  }

  async anonymizeAllBySenderUserId(userId: UserId, at: Date): Promise<void> {
    await this.prismaContext.client.message.updateMany({
      where: { senderUserId: userId.value, anonymizedAt: null },
      data: { body: '[removed]', anonymizedAt: at, updatedAt: at },
    });
  }
}
