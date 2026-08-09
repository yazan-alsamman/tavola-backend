import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { User } from '../../domain/entities/user.entity';
import { Email } from '@shared/domain/value-objects/email.vo';
import {
  UpdatePasswordIfCurrentHashMatchesOutcome,
  UserRepository,
} from '../../domain/repositories/authentication.repositories';
import { UserPrismaMapper } from './user.prisma-mapper';
import { UserStatus } from '../../domain/enums/authentication.enums';
import { EmailAlreadyExistsException } from '../../domain/exceptions/email-already-exists.exception';
import { PhoneAlreadyExistsException } from '../../domain/exceptions/phone-already-exists.exception';
import { UsernameAlreadyExistsException } from '../../domain/exceptions/username-already-exists.exception';

function violatesUniqueColumn(error: unknown, column: string): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes(column);
  }
  return typeof target === 'string' && target.includes(column);
}

@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async findById(id: UserId): Promise<User | null> {
    const row = await this.prismaContext.client.user.findUnique({
      where: { id: id.value },
    });
    return row ? UserPrismaMapper.toDomain(row) : null;
  }

  async findManyByIds(ids: UserId[]): Promise<User[]> {
    if (ids.length === 0) {
      return [];
    }
    const uniqueIds = [...new Set(ids.map((id) => id.value))];
    const rows = await this.prismaContext.client.user.findMany({
      where: { id: { in: uniqueIds } },
    });
    return rows.map(UserPrismaMapper.toDomain);
  }

  async findByEmail(email: Email): Promise<User | null> {
    const row = await this.prismaContext.client.user.findFirst({
      where: { email: email.value, deletedAt: null },
    });
    return row ? UserPrismaMapper.toDomain(row) : null;
  }

  async existsByEmail(email: Email): Promise<boolean> {
    const count = await this.prismaContext.client.user.count({
      where: { email: email.value, deletedAt: null },
    });
    return count > 0;
  }

  /** ADR-022 (Phase 2.23): Customer login/lookup by canonical E.164 phone. */
  async findByPhone(phone: string): Promise<User | null> {
    const row = await this.prismaContext.client.user.findFirst({
      where: { phone, deletedAt: null },
    });
    return row ? UserPrismaMapper.toDomain(row) : null;
  }

  async existsByPhone(phone: string): Promise<boolean> {
    const count = await this.prismaContext.client.user.count({
      where: { phone, deletedAt: null },
    });
    return count > 0;
  }

  async existsByUsername(username: string): Promise<boolean> {
    const count = await this.prismaContext.client.user.count({
      where: { username, deletedAt: null },
    });
    return count > 0;
  }

  async save(user: User): Promise<void> {
    const data = UserPrismaMapper.toPersistence(user);
    try {
      await this.prismaContext.client.user.upsert({
        where: { id: data.id },
        create: data,
        update: {
          firstName: data.firstName,
          lastName: data.lastName,
          email: data.email,
          phone: data.phone,
          username: data.username,
          passwordHash: data.passwordHash,
          language: data.language,
          preferredCurrency: data.preferredCurrency,
          notificationOptIn: data.notificationOptIn,
          marketingOptIn: data.marketingOptIn,
          status: data.status,
          emailVerified: data.emailVerified,
          failedLoginCount: data.failedLoginCount,
          lockedUntil: data.lockedUntil,
          permissionsVersion: data.permissionsVersion,
          sessionVersion: data.sessionVersion,
          passwordChangedAt: data.passwordChangedAt,
          lastLoginAt: data.lastLoginAt,
          anonymizedAt: data.anonymizedAt,
          deletionRequestedAt: data.deletionRequestedAt,
          scheduledAnonymizationAt: data.scheduledAnonymizationAt,
          updatedAt: data.updatedAt,
          deletedAt: data.deletedAt,
        },
      });
    } catch (error) {
      if (violatesUniqueColumn(error, 'email')) {
        throw new EmailAlreadyExistsException(data.email ?? '');
      }
      if (violatesUniqueColumn(error, 'phone')) {
        throw new PhoneAlreadyExistsException();
      }
      if (violatesUniqueColumn(error, 'username')) {
        throw new UsernameAlreadyExistsException();
      }
      throw error;
    }
  }

  async getAvatarId(userId: UserId): Promise<string | null> {
    const row = await this.prismaContext.client.user.findUnique({
      where: { id: userId.value },
      select: { avatarId: true },
    });
    return row?.avatarId ?? null;
  }

  async updateAvatarId(userId: UserId, avatarId: string | null, at: Date): Promise<void> {
    await this.prismaContext.client.user.update({
      where: { id: userId.value },
      data: { avatarId, updatedAt: at },
    });
  }

  async incrementSessionVersion(userId: UserId, at: Date): Promise<number | null> {
    try {
      const row = await this.prismaContext.client.user.update({
        where: { id: userId.value },
        data: {
          sessionVersion: { increment: 1 },
          updatedAt: at,
        },
        select: { sessionVersion: true },
      });
      return row.sessionVersion;
    } catch {
      return null;
    }
  }

  async updatePasswordIfCurrentHashMatches(input: {
    userId: UserId;
    expectedCurrentHash: string;
    newHash: string;
    at: Date;
  }): Promise<UpdatePasswordIfCurrentHashMatchesOutcome> {
    const result = await this.prismaContext.client.user.updateMany({
      where: {
        id: input.userId.value,
        passwordHash: input.expectedCurrentHash,
      },
      data: {
        passwordHash: input.newHash,
        sessionVersion: { increment: 1 },
        passwordChangedAt: input.at,
        failedLoginCount: 0,
        lockedUntil: null,
        updatedAt: input.at,
      },
    });

    if (result.count !== 1) {
      return { status: 'hash_mismatch' };
    }

    const row = await this.prismaContext.client.user.findUnique({
      where: { id: input.userId.value },
      select: { sessionVersion: true, status: true },
    });

    if (!row) {
      return { status: 'hash_mismatch' };
    }

    if (row.status === UserStatus.Locked) {
      await this.prismaContext.client.user.update({
        where: { id: input.userId.value },
        data: { status: UserStatus.Active },
      });
    }

    return { status: 'updated', sessionVersion: row.sessionVersion };
  }
}
