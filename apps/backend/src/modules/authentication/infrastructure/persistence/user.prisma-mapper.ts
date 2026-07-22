import { User, UserStatus as PrismaUserStatus } from '@prisma/client';
import { User as UserEntity } from '../../domain/entities/user.entity';
import { UserStatus } from '../../domain/enums/authentication.enums';

export class UserPrismaMapper {
  static toDomain(row: User): UserEntity {
    return UserEntity.reconstitute({
      id: row.id,
      firstName: row.firstName,
      lastName: row.lastName,
      email: row.email,
      phone: row.phone,
      username: row.username,
      passwordHash: row.passwordHash,
      language: row.language,
      preferredCurrency: row.preferredCurrency,
      notificationOptIn: row.notificationOptIn,
      marketingOptIn: row.marketingOptIn,
      status: row.status as UserStatus,
      emailVerified: row.emailVerified,
      failedLoginCount: row.failedLoginCount,
      lockedUntil: row.lockedUntil,
      permissionsVersion: row.permissionsVersion,
      sessionVersion: row.sessionVersion,
      passwordChangedAt: row.passwordChangedAt,
      lastLoginAt: row.lastLoginAt,
      anonymizedAt: row.anonymizedAt,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    });
  }

  static toPersistence(user: UserEntity): Omit<User, 'avatarId'> & { avatarId: string | null } {
    const props = user.toProps();
    return {
      id: props.id,
      firstName: props.firstName,
      lastName: props.lastName,
      email: props.email,
      phone: props.phone,
      username: props.username,
      passwordHash: props.passwordHash,
      avatarId: null,
      language: props.language,
      preferredCurrency: props.preferredCurrency,
      notificationOptIn: props.notificationOptIn,
      marketingOptIn: props.marketingOptIn,
      status: props.status as PrismaUserStatus,
      emailVerified: props.emailVerified,
      failedLoginCount: props.failedLoginCount,
      lockedUntil: props.lockedUntil,
      permissionsVersion: props.permissionsVersion,
      sessionVersion: props.sessionVersion,
      passwordChangedAt: props.passwordChangedAt,
      lastLoginAt: props.lastLoginAt,
      anonymizedAt: props.anonymizedAt,
      createdAt: props.createdAt,
      updatedAt: props.updatedAt,
      deletedAt: props.deletedAt,
    };
  }
}
