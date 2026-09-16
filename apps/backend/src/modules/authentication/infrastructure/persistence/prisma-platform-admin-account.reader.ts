import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  PlatformAdminAccountDetailRow,
  PlatformAdminAccountQuery,
  PlatformAdminAccountReaderPort,
  PlatformAdminAccountRow,
  PlatformAdminAccountType,
} from '../../application/ports/platform-admin-account-reader.port';

/** The three signals the account-type derivation needs, nothing more. */
interface AccountTypeSignals {
  platformAdmin: { revokedAt: Date | null } | null;
  hasOrganizationMembership: boolean;
  hasEmployeeRecord: boolean;
}

/**
 * ADR-035 Pattern 2 — injects the raw `PrismaService` rather than
 * `PrismaContext`, for the same reason `PrismaAuditLogReader` does: a
 * platform-wide account listing has no single `organizationId` to bind, and
 * Customers belong to no Organization at all. Added by name to
 * `.eslintrc.js`'s `no-restricted-imports` `excludedFiles` whitelist.
 * Read-only.
 */
@Injectable()
export class PrismaPlatformAdminAccountReader implements PlatformAdminAccountReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async search(
    query: PlatformAdminAccountQuery,
  ): Promise<{ items: PlatformAdminAccountRow[]; total: number }> {
    // Conditions are only added when they apply, so an omitted or blank
    // filter contributes no clause at all. Emitting `contains: ''` for every
    // searchable column would be a full scan that additionally drops rows
    // whose columns are NULL - and email/phone/username are all nullable
    // here, since each is collected for only some actor types.
    const conditions: Prisma.UserWhereInput[] = [];

    const term = query.q?.trim();
    if (term) {
      conditions.push({
        OR: [
          { email: { contains: term, mode: 'insensitive' } },
          { phone: { contains: term, mode: 'insensitive' } },
          { username: { contains: term, mode: 'insensitive' } },
          { firstName: { contains: term, mode: 'insensitive' } },
          { lastName: { contains: term, mode: 'insensitive' } },
        ],
      });
    }

    if (query.status) {
      conditions.push({ status: query.status as Prisma.EnumUserStatusFilter['equals'] });
    }

    if (query.accountType) {
      conditions.push(accountTypeFilter(query.accountType));
    }

    const where: Prisma.UserWhereInput = conditions.length > 0 ? { AND: conditions } : {};

    // One `where` drives both queries, so the reported total can never
    // describe a different filter than the returned rows.
    const [rows, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          phone: true,
          username: true,
          firstName: true,
          lastName: true,
          status: true,
          emailVerified: true,
          lastLoginAt: true,
          createdAt: true,
          deletedAt: true,
          platformAdmin: { select: { revokedAt: true } },
          // `take: 1` - only existence matters for the type derivation, so
          // an Organization-heavy account does not drag rows into memory.
          organizationMembers: { select: { id: true }, take: 1 },
          employees: { select: { id: true }, where: { deletedAt: null }, take: 1 },
        },
        orderBy: { createdAt: 'desc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      items: rows.map((row) => ({
        userId: row.id,
        email: row.email,
        phone: row.phone,
        username: row.username,
        firstName: row.firstName,
        lastName: row.lastName,
        status: row.status,
        accountType: resolveAccountType({
          platformAdmin: row.platformAdmin,
          hasOrganizationMembership: row.organizationMembers.length > 0,
          hasEmployeeRecord: row.employees.length > 0,
        }),
        emailVerified: row.emailVerified,
        lastLoginAt: row.lastLoginAt,
        createdAt: row.createdAt,
        deletedAt: row.deletedAt,
      })),
      total,
    };
  }

  async findDetailById(userId: string): Promise<PlatformAdminAccountDetailRow | null> {
    const now = new Date();
    const row = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        phone: true,
        username: true,
        firstName: true,
        lastName: true,
        status: true,
        emailVerified: true,
        language: true,
        preferredCurrency: true,
        notificationOptIn: true,
        marketingOptIn: true,
        failedLoginCount: true,
        lockedUntil: true,
        passwordChangedAt: true,
        lastLoginAt: true,
        deletionRequestedAt: true,
        scheduledAnonymizationAt: true,
        anonymizedAt: true,
        createdAt: true,
        updatedAt: true,
        deletedAt: true,
        platformAdmin: { select: { revokedAt: true } },
        employees: { select: { id: true }, where: { deletedAt: null }, take: 1 },
        organizationMembers: {
          select: {
            organizationId: true,
            role: true,
            status: true,
            organization: { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (row === null) {
      return null;
    }

    // Counted here rather than exposed as a session list: the console needs
    // "is anyone logged in as this account right now" to decide whether Force
    // Logout is worth doing, not the sessions themselves. Mirrors
    // `DeviceSession.isActive`'s own definition - not revoked, not expired.
    const activeSessionCount = await this.prisma.deviceSession.count({
      where: { userId, revokedAt: null, expiresAt: { gt: now } },
    });

    return {
      userId: row.id,
      email: row.email,
      phone: row.phone,
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      status: row.status,
      accountType: resolveAccountType({
        platformAdmin: row.platformAdmin,
        hasOrganizationMembership: row.organizationMembers.length > 0,
        hasEmployeeRecord: row.employees.length > 0,
      }),
      emailVerified: row.emailVerified,
      language: row.language,
      preferredCurrency: row.preferredCurrency,
      notificationOptIn: row.notificationOptIn,
      marketingOptIn: row.marketingOptIn,
      failedLoginCount: row.failedLoginCount,
      lockedUntil: row.lockedUntil,
      passwordChangedAt: row.passwordChangedAt,
      lastLoginAt: row.lastLoginAt,
      deletionRequestedAt: row.deletionRequestedAt,
      scheduledAnonymizationAt: row.scheduledAnonymizationAt,
      anonymizedAt: row.anonymizedAt,
      activeSessionCount,
      organizations: row.organizationMembers.map((member) => ({
        organizationId: member.organizationId,
        organizationName: member.organization.name,
        role: member.role,
        status: member.status,
      })),
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      deletedAt: row.deletedAt,
    };
  }
}

/**
 * First match wins, in authority order. A revoked `PlatformAdmin` row does
 * not count - the grant is gone, so the account is whatever it is otherwise,
 * which is what the console should act on.
 */
function resolveAccountType(signals: AccountTypeSignals): PlatformAdminAccountType {
  if (signals.platformAdmin !== null && signals.platformAdmin.revokedAt === null) {
    return 'PlatformAdmin';
  }
  if (signals.hasOrganizationMembership) {
    return 'OrganizationMember';
  }
  if (signals.hasEmployeeRecord) {
    return 'Employee';
  }
  return 'Customer';
}

/**
 * The `where` clause equivalent of {@link resolveAccountType}. Each branch
 * must negate the higher-precedence types explicitly, otherwise filtering by
 * `Customer` would also return every Employee (who has no
 * `organizationMembers` either) and the filter would disagree with the
 * `accountType` the same endpoint reports on each row.
 */
function accountTypeFilter(accountType: PlatformAdminAccountType): Prisma.UserWhereInput {
  const notPlatformAdmin: Prisma.UserWhereInput = {
    OR: [{ platformAdmin: { is: null } }, { platformAdmin: { revokedAt: { not: null } } }],
  };

  switch (accountType) {
    case 'PlatformAdmin':
      return { platformAdmin: { is: { revokedAt: null } } };
    case 'OrganizationMember':
      return { AND: [notPlatformAdmin, { organizationMembers: { some: {} } }] };
    case 'Employee':
      return {
        AND: [
          notPlatformAdmin,
          { organizationMembers: { none: {} } },
          { employees: { some: { deletedAt: null } } },
        ],
      };
    case 'Customer':
      return {
        AND: [
          notPlatformAdmin,
          { organizationMembers: { none: {} } },
          { employees: { none: { deletedAt: null } } },
        ],
      };
  }
}
