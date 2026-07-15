import { TokenFamily as PrismaTokenFamily } from '@prisma/client';
import { TokenFamily } from '../../domain/entities/token-family.entity';

export class TokenFamilyPrismaMapper {
  static toDomain(row: PrismaTokenFamily): TokenFamily {
    return TokenFamily.reconstitute({
      id: row.id,
      userId: row.userId,
      compromisedAt: row.compromisedAt,
      revokedAt: row.revokedAt,
      createdAt: row.createdAt,
    });
  }

  static toPersistence(family: TokenFamily): PrismaTokenFamily {
    const props = family.toProps();
    return {
      id: props.id,
      userId: props.userId,
      compromisedAt: props.compromisedAt,
      revokedAt: props.revokedAt,
      createdAt: props.createdAt,
    };
  }
}
