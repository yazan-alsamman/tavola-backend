import { Injectable } from '@nestjs/common';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { TokenFamilyId, UserId } from '@shared/domain/value-objects/identifiers.vo';
import { TokenFamily } from '../../domain/entities/token-family.entity';
import { TokenFamilyRepository } from '../../domain/repositories/authentication.repositories';
import { TokenFamilyPrismaMapper } from './token-family.prisma-mapper';

@Injectable()
export class PrismaTokenFamilyRepository implements TokenFamilyRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: TokenFamilyId): Promise<TokenFamily | null> {
    const row = await this.prismaContext.client.tokenFamily.findUnique({
      where: { id: id.value },
    });
    return row ? TokenFamilyPrismaMapper.toDomain(row) : null;
  }

  async save(family: TokenFamily): Promise<void> {
    const data = TokenFamilyPrismaMapper.toPersistence(family);
    await this.prismaContext.client.tokenFamily.upsert({
      where: { id: data.id },
      create: data,
      update: {
        compromisedAt: data.compromisedAt,
        revokedAt: data.revokedAt,
      },
    });
  }

  async revokeAllByUserId(userId: UserId, at: Date): Promise<void> {
    await this.prismaContext.client.tokenFamily.updateMany({
      where: {
        userId: userId.value,
        revokedAt: null,
      },
      data: { revokedAt: at },
    });
  }

  async revokeAllByUserIdExceptFamily(input: {
    userId: UserId;
    exceptTokenFamilyId: TokenFamilyId;
    at: Date;
  }): Promise<void> {
    await this.prismaContext.client.tokenFamily.updateMany({
      where: {
        userId: input.userId.value,
        revokedAt: null,
        id: { not: input.exceptTokenFamilyId.value },
      },
      data: { revokedAt: input.at },
    });
  }

  async markCompromisedIfActive(id: TokenFamilyId, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.tokenFamily.updateMany({
      where: {
        id: id.value,
        compromisedAt: null,
      },
      data: {
        compromisedAt: at,
        revokedAt: at,
      },
    });
    return result.count === 1;
  }
}
