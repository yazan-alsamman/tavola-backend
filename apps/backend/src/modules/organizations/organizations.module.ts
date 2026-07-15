import { Module } from '@nestjs/common';
import { PrismaOrganizationRepository } from './infrastructure/persistence/prisma-organization.repository';
import { PrismaOrganizationMemberRepository } from './infrastructure/persistence/prisma-organization-member.repository';
import {
  ORGANIZATION_MEMBER_REPOSITORY,
  ORGANIZATION_REPOSITORY,
} from './application/tokens/organizations.tokens';

/**
 * Phase 2.20 — first real DI wiring for this module (previously an empty
 * scaffold per its own comment: "not registered until its owning phase is
 * explicitly approved"). `RegisterOrganizationOwnerUseCase` (Phase 2.5,
 * application-layer only until now) is the first, and so far only, consumer
 * of these tokens - imported by `AuthenticationModule`. No new repository
 * methods, no new business logic: `PrismaOrganizationRepository`/
 * `PrismaOrganizationMemberRepository` already existed (Phase 2.12), just
 * without a module to register them in.
 */
@Module({
  providers: [
    PrismaOrganizationRepository,
    PrismaOrganizationMemberRepository,
    { provide: ORGANIZATION_REPOSITORY, useExisting: PrismaOrganizationRepository },
    { provide: ORGANIZATION_MEMBER_REPOSITORY, useExisting: PrismaOrganizationMemberRepository },
  ],
  exports: [ORGANIZATION_REPOSITORY, ORGANIZATION_MEMBER_REPOSITORY],
})
export class OrganizationsModule {}
