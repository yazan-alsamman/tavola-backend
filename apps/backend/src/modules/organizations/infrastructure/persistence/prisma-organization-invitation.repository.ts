import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { OrganizationId } from '@shared/domain/value-objects/identifiers.vo';
import { OrganizationInvitation } from '../../domain/entities/organization-invitation.entity';
import { OrganizationInvitationRepository } from '../../domain/repositories/organization.repository';
import { OrganizationInvitationStatus } from '../../domain/enums/organization.enums';
import { DuplicatePendingInvitationException } from '../../domain/exceptions/duplicate-pending-invitation.exception';
import { OrganizationInvitationPrismaMapper } from './organization-invitation.prisma-mapper';

/**
 * Prisma cannot resolve a hand-written (non-Prisma-native) partial unique
 * index back to its own name - `error.meta.target` for
 * `organization_invitations_org_email_one_pending_key` surfaces as the raw
 * column array `['organization_id', 'email']` instead (verified against a
 * real P2002 thrown by this exact index, not assumed). `email` alone is
 * sufficient to identify it: it is the only unique-constraint-bearing
 * column on this table besides `token_hash` (checked separately by Prisma
 * under its own, differently-shaped `@unique` column target).
 */
function violatesPendingUniqueIndex(error: unknown): boolean {
  if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') {
    return false;
  }
  const target = error.meta?.target;
  if (Array.isArray(target)) {
    return target.includes('email') && target.includes('organization_id');
  }
  return typeof target === 'string' && target.includes('email');
}

/**
 * `OrganizationInvitation` is deliberately NOT in `withTenantScoping`'s
 * `DIRECT_TENANT_OWNED_MODELS` (see the model's own schema.prisma comment) -
 * every query below that must not cross tenants passes `organizationId`
 * explicitly in its own `where` clause instead of relying on the automatic
 * Prisma extension; `findByTokenHash` is the sole deliberate exception
 * (unscoped, mirrors `PrismaPasswordResetRepository.findByTokenHash`).
 */
@Injectable()
export class PrismaOrganizationInvitationRepository implements OrganizationInvitationRepository {
  constructor(private readonly prismaContext: PrismaContext) {}

  async save(invitation: OrganizationInvitation): Promise<void> {
    const data = OrganizationInvitationPrismaMapper.toPersistence(invitation);
    try {
      await this.prismaContext.client.organizationInvitation.upsert({
        where: { id: data.id },
        create: data,
        update: {
          status: data.status,
          acceptedAt: data.acceptedAt,
          updatedAt: data.updatedAt,
        },
      });
    } catch (error) {
      if (violatesPendingUniqueIndex(error)) {
        throw new DuplicatePendingInvitationException();
      }
      throw error;
    }
  }

  async findById(
    id: string,
    organizationId: OrganizationId,
  ): Promise<OrganizationInvitation | null> {
    const row = await this.prismaContext.client.organizationInvitation.findFirst({
      where: { id, organizationId: organizationId.value },
    });
    return row ? OrganizationInvitationPrismaMapper.toDomain(row) : null;
  }

  async findByTokenHash(tokenHash: string): Promise<OrganizationInvitation | null> {
    const row = await this.prismaContext.client.organizationInvitation.findUnique({
      where: { tokenHash },
    });
    return row ? OrganizationInvitationPrismaMapper.toDomain(row) : null;
  }

  async findActivePendingByOrganizationAndEmail(
    organizationId: OrganizationId,
    email: string,
  ): Promise<OrganizationInvitation | null> {
    const row = await this.prismaContext.client.organizationInvitation.findFirst({
      where: {
        organizationId: organizationId.value,
        email,
        status: OrganizationInvitationStatus.Pending,
      },
    });
    return row ? OrganizationInvitationPrismaMapper.toDomain(row) : null;
  }

  async listByOrganization(
    organizationId: OrganizationId,
    page: number,
    limit: number,
  ): Promise<{ items: OrganizationInvitation[]; total: number }> {
    const where = { organizationId: organizationId.value };
    const [rows, total] = await Promise.all([
      this.prismaContext.client.organizationInvitation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prismaContext.client.organizationInvitation.count({ where }),
    ]);
    return { items: rows.map(OrganizationInvitationPrismaMapper.toDomain), total };
  }

  async revokePendingByOrganizationAndEmail(
    organizationId: OrganizationId,
    email: string,
    at: Date,
  ): Promise<void> {
    await this.prismaContext.client.organizationInvitation.updateMany({
      where: {
        organizationId: organizationId.value,
        email,
        status: OrganizationInvitationStatus.Pending,
      },
      data: { status: OrganizationInvitationStatus.Revoked, updatedAt: at },
    });
  }

  async revokeIfPending(id: string, organizationId: OrganizationId, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.organizationInvitation.updateMany({
      where: {
        id,
        organizationId: organizationId.value,
        status: OrganizationInvitationStatus.Pending,
      },
      data: { status: OrganizationInvitationStatus.Revoked, updatedAt: at },
    });
    return result.count > 0;
  }

  async consumeIfPending(id: string, at: Date): Promise<boolean> {
    const result = await this.prismaContext.client.organizationInvitation.updateMany({
      where: {
        id,
        status: OrganizationInvitationStatus.Pending,
        expiresAt: { gt: at },
      },
      data: { status: OrganizationInvitationStatus.Accepted, acceptedAt: at, updatedAt: at },
    });
    return result.count === 1;
  }
}
