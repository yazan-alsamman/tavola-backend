import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  LoginOrganizationReaderPort,
  LoginOrganizationSnapshot,
} from '../../application/ports/login-organization-reader.port';

/**
 * Deliberately injects the raw `PrismaService` instead of `PrismaContext`
 * (Phase 2.13.1 tenant-enforcement wiring) - the ESLint override in
 * `.eslintrc.js` that blocks direct `PrismaService` imports from
 * `modules/**\/infrastructure/persistence/**` explicitly excludes this file
 * for the same reason.
 *
 * This query touches `OrganizationMember` (a tenant-owned model per
 * ADR-012) but must NOT go through the tenant-scoped client: it runs during
 * Login, before any TenantContext can exist (there is no JWT yet - this
 * query is what discovers which organization(s), if any, the user belongs
 * to). It is filtered by the caller's own verified `userId`, never by
 * `organizationId`, so it cannot leak another user's - and therefore
 * another tenant's - membership row; the security boundary here is "only
 * your own memberships", not "only this tenant's rows", so tenant scoping
 * does not apply.
 */
@Injectable()
export class PrismaLoginOrganizationReader implements LoginOrganizationReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async findByUserId(userId: UserId): Promise<LoginOrganizationSnapshot | null> {
    const row = await this.prisma.organizationMember.findFirst({
      where: {
        userId: userId.value,
        status: 'Active',
      },
      include: {
        organization: true,
      },
      orderBy: { joinedAt: 'desc' },
    });

    if (!row || row.organization.deletedAt !== null) {
      return null;
    }

    return {
      organizationId: row.organizationId,
      name: row.organization.name,
      slug: row.organization.slug,
      role: row.role,
    };
  }
}
