import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { ConversationId, EmployeeId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { ConversationParticipant } from '../../domain/entities/conversation-participant.entity';
import { ConversationParticipantRepository } from '../../domain/repositories/conversation-participant.repository';
import { ConversationParticipantPrismaMapper } from './conversation-participant.prisma-mapper';

@Injectable()
export class PrismaConversationParticipantRepository implements ConversationParticipantRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findByConversationAndUser(
    conversationId: ConversationId,
    userId: UserId,
  ): Promise<ConversationParticipant | null> {
    const row = await this.prismaContext.client.conversationParticipant.findFirst({
      where: { conversationId: conversationId.value, userId: userId.value },
    });
    return row ? ConversationParticipantPrismaMapper.toDomain(row) : null;
  }

  async findByConversationAndEmployee(
    conversationId: ConversationId,
    employeeId: EmployeeId,
  ): Promise<ConversationParticipant | null> {
    const row = await this.prismaContext.client.conversationParticipant.findFirst({
      where: { conversationId: conversationId.value, employeeId: employeeId.value },
    });
    return row ? ConversationParticipantPrismaMapper.toDomain(row) : null;
  }

  async findCustomerParticipant(
    conversationId: ConversationId,
  ): Promise<ConversationParticipant | null> {
    const row = await this.prismaContext.client.conversationParticipant.findFirst({
      where: { conversationId: conversationId.value, role: 'Customer' },
    });
    return row ? ConversationParticipantPrismaMapper.toDomain(row) : null;
  }

  /**
   * DECISIONS.md D2 - participant rows are created lazily by concurrent
   * requests (first send/read race). The unique partial indexes on
   * `(conversationId, userId)`/`(conversationId, employeeId)` are the
   * authority; a concurrent-insert `P2002` here is swallowed as a no-op
   * (the other request's row already satisfies "a participant row exists")
   * rather than surfaced as an error -
   * `ConversationParticipantResolverService` always re-queries after a
   * `create()` call, so it observes whichever row actually won.
   */
  async create(participant: ConversationParticipant): Promise<void> {
    const data = ConversationParticipantPrismaMapper.toPersistence(participant);
    try {
      await this.prismaContext.client.conversationParticipant.create({ data });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return;
      }
      throw error;
    }
  }

  async update(participant: ConversationParticipant): Promise<void> {
    const data = ConversationParticipantPrismaMapper.toPersistence(participant);
    await this.prismaContext.client.conversationParticipant.update({
      where: { id: data.id },
      data: {
        lastReadAt: data.lastReadAt,
        leftAt: data.leftAt,
      },
    });
  }
}
