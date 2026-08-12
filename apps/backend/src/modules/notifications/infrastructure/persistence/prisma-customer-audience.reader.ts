import { Injectable } from '@nestjs/common';
import { Prisma, UserStatus } from '@prisma/client';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  CustomerAudienceBatch,
  CustomerAudienceReaderPort,
} from '../../application/ports/customer-audience-reader.port';

/**
 * ADR-037 Pattern 2 (ADR-035) — deliberately injects the raw `PrismaService`
 * instead of the tenant-scoped repository: "Customer" (`User` with no
 * `OrganizationMember`/`Employee`/`PlatformAdmin` row) is platform-global,
 * identical justification to `PrismaPlatformAdminNotificationStatsReader`.
 * Added by name to `.eslintrc.js`'s `no-restricted-imports` `excludedFiles`
 * whitelist. Read-only.
 *
 * `organizationMembers: { none: {} }` / `employees: { none: {} }` /
 * `platformAdmin: null` express the ADR-022 "Customer = User with no other
 * actor-type row" classification directly through Prisma's relation
 * filters — no raw SQL, no `NOT EXISTS` subquery hand-written.
 */
@Injectable()
export class PrismaCustomerAudienceReader implements CustomerAudienceReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  private static readonly identityWhere: Prisma.UserWhereInput = {
    status: UserStatus.Active,
    deletedAt: null,
    deletionRequestedAt: null,
    organizationMembers: { none: {} },
    employees: { none: {} },
    platformAdmin: null,
  };

  private static readonly broadcastWhere: Prisma.UserWhereInput = {
    ...PrismaCustomerAudienceReader.identityWhere,
    marketingOptIn: true,
  };

  async isEligibleCustomer(userId: string): Promise<boolean> {
    const count = await this.prisma.user.count({
      where: { id: userId, ...PrismaCustomerAudienceReader.identityWhere },
    });
    return count > 0;
  }

  async countBroadcastEligibleCustomers(): Promise<number> {
    return this.prisma.user.count({ where: PrismaCustomerAudienceReader.broadcastWhere });
  }

  async listBroadcastEligibleCustomerBatch(
    cursor: string | null,
    batchSize: number,
  ): Promise<CustomerAudienceBatch> {
    const rows = await this.prisma.user.findMany({
      where: PrismaCustomerAudienceReader.broadcastWhere,
      select: { id: true },
      orderBy: { id: 'asc' },
      take: batchSize,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    const userIds = rows.map((row) => row.id);
    const nextCursor = rows.length === batchSize ? userIds[userIds.length - 1] : null;
    return { userIds, nextCursor };
  }
}
