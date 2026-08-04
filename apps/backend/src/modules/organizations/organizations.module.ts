import { forwardRef, Module } from '@nestjs/common';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { PlatformAdminModule } from '@modules/platform-admin/platform-admin.module';
import { PrismaOrganizationRepository } from './infrastructure/persistence/prisma-organization.repository';
import { PrismaOrganizationMemberRepository } from './infrastructure/persistence/prisma-organization-member.repository';
import {
  ORGANIZATION_MEMBER_REPOSITORY,
  ORGANIZATION_REPOSITORY,
} from './application/tokens/organizations.tokens';
import { PlatformAdminSuspendOrganizationUseCase } from './application/use-cases/platform-admin-suspend-organization.use-case';
import { PlatformAdminReactivateOrganizationUseCase } from './application/use-cases/platform-admin-reactivate-organization.use-case';
import { PlatformAdminTransferOrganizationOwnershipUseCase } from './application/use-cases/platform-admin-transfer-organization-ownership.use-case';
import { PlatformAdminOrganizationsController } from './presentation/controllers/platform-admin-organizations.controller';

/**
 * Phase 2.20 — first real DI wiring for this module (previously an empty
 * scaffold per its own comment: "not registered until its owning phase is
 * explicitly approved"). `RegisterOrganizationOwnerUseCase` (Phase 2.5,
 * application-layer only until now) is the first, and so far only, consumer
 * of these tokens - imported by `AuthenticationModule`. No new repository
 * methods, no new business logic: `PrismaOrganizationRepository`/
 * `PrismaOrganizationMemberRepository` already existed (Phase 2.12), just
 * without a module to register them in.
 *
 * Phase 19.1 (ADR-034 §4/§6): this module's first real use-case/controller
 * layer. Needs `CLOCK`/`ID_GENERATOR`/`UNIT_OF_WORK` from `AuthenticationModule`,
 * which in turn already imported this module (plainly) for
 * `ORGANIZATION_REPOSITORY`/`ORGANIZATION_MEMBER_REPOSITORY` - a genuine
 * circular pair, resolved with `forwardRef` on both sides (that module's own
 * import of this one converted accordingly), matching the established
 * `RestaurantsModule`↔`SubscriptionsModule`↔`AuthenticationModule` precedent.
 * `PlatformAdminModule` (for `PlatformAdminGuard`/`PlatformAdminRoleGuard`) is
 * imported plainly - it does not depend back on this module.
 */
@Module({
  imports: [forwardRef(() => AuthenticationModule), PlatformAdminModule],
  controllers: [PlatformAdminOrganizationsController],
  providers: [
    PlatformAdminSuspendOrganizationUseCase,
    PlatformAdminReactivateOrganizationUseCase,
    PlatformAdminTransferOrganizationOwnershipUseCase,
    PrismaOrganizationRepository,
    PrismaOrganizationMemberRepository,
    { provide: ORGANIZATION_REPOSITORY, useExisting: PrismaOrganizationRepository },
    { provide: ORGANIZATION_MEMBER_REPOSITORY, useExisting: PrismaOrganizationMemberRepository },
  ],
  exports: [ORGANIZATION_REPOSITORY, ORGANIZATION_MEMBER_REPOSITORY],
})
export class OrganizationsModule {}
