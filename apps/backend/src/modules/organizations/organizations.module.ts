import { forwardRef, Module } from '@nestjs/common';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { PlatformAdminModule } from '@modules/platform-admin/platform-admin.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { SmtpEmailProvider } from '@infrastructure/email/providers/smtp/smtp-email.provider';
import { EMAIL_PROVIDER } from '@shared/application/ports/email-provider.port';
import { PrismaOrganizationRepository } from './infrastructure/persistence/prisma-organization.repository';
import { PrismaOrganizationMemberRepository } from './infrastructure/persistence/prisma-organization-member.repository';
import { PrismaOrganizationInvitationRepository } from './infrastructure/persistence/prisma-organization-invitation.repository';
import { PrismaPlatformAdminOrganizationStatsReader } from './infrastructure/persistence/prisma-platform-admin-organization-stats.reader';
import {
  ORGANIZATION_INVITATION_REPOSITORY,
  ORGANIZATION_MEMBER_REPOSITORY,
  ORGANIZATION_REPOSITORY,
} from './application/tokens/organizations.tokens';
import { PLATFORM_ADMIN_ORGANIZATION_STATS_READER } from './application/ports/platform-admin-organization-stats-reader.port';
import { PlatformAdminSuspendOrganizationUseCase } from './application/use-cases/platform-admin-suspend-organization.use-case';
import { PlatformAdminReactivateOrganizationUseCase } from './application/use-cases/platform-admin-reactivate-organization.use-case';
import { PlatformAdminDeleteOrganizationUseCase } from './application/use-cases/platform-admin-delete-organization.use-case';
import { PlatformAdminRestoreOrganizationUseCase } from './application/use-cases/platform-admin-restore-organization.use-case';
import { PlatformAdminTransferOrganizationOwnershipUseCase } from './application/use-cases/platform-admin-transfer-organization-ownership.use-case';
import { SearchOrganizationsUseCase } from './application/use-cases/search-organizations.use-case';
import { ListOrganizationMembersUseCase } from './application/use-cases/list-organization-members.use-case';
import { ChangeOrganizationMemberRoleUseCase } from './application/use-cases/change-organization-member-role.use-case';
import { RemoveOrganizationMemberUseCase } from './application/use-cases/remove-organization-member.use-case';
import { SelfServiceTransferOrganizationOwnershipUseCase } from './application/use-cases/self-service-transfer-organization-ownership.use-case';
import { IssueOrganizationInvitationUseCase } from './application/use-cases/issue-organization-invitation.use-case';
import { ListOrganizationInvitationsUseCase } from './application/use-cases/list-organization-invitations.use-case';
import { RevokeOrganizationInvitationUseCase } from './application/use-cases/revoke-organization-invitation.use-case';
import { AcceptOrganizationInvitationUseCase } from './application/use-cases/accept-organization-invitation.use-case';
import { PlatformAdminOrganizationsController } from './presentation/controllers/platform-admin-organizations.controller';
import { OrganizationMembersController } from './presentation/controllers/organization-members.controller';
import { OrganizationInvitationsController } from './presentation/controllers/organization-invitations.controller';
import { OrganizationInvitationAcceptanceController } from './presentation/controllers/organization-invitation-acceptance.controller';

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
 * `PlatformAdminModule` (for `PlatformAdminGuard`/`PlatformAdminRoleGuard`) DOES
 * depend back on this module transitively - `PlatformAdminModule` imports
 * `AuthenticationModule` (`forwardRef`), which imports this module
 * (`forwardRef`), closing a genuine three-module cycle
 * (`OrganizationsModule` -> `PlatformAdminModule` -> `AuthenticationModule` ->
 * `OrganizationsModule`). M3 remediation: per `RestaurantsModule`'s own doc
 * comment ("`forwardRef` closing only one edge is not sufficient once a
 * third module sits in the same cycle"), this module's `PlatformAdminModule`
 * import is wrapped in `forwardRef` too, closing all three edges of this
 * cycle instead of two.
 *
 * Phase 19.7 (Organization self-service member management, ADR-034 §7,
 * previously deferred, explicitly authorized this session): imports
 * `AuthorizationModule` (plain - no cycle, `AuthorizationModule` itself has
 * zero module imports) for `OrganizationMemberGuard`, gating the new
 * `OrganizationMembersController`.
 */
@Module({
  imports: [
    forwardRef(() => AuthenticationModule),
    forwardRef(() => PlatformAdminModule),
    AuthorizationModule,
  ],
  controllers: [
    PlatformAdminOrganizationsController,
    OrganizationMembersController,
    OrganizationInvitationsController,
    OrganizationInvitationAcceptanceController,
  ],
  providers: [
    PlatformAdminSuspendOrganizationUseCase,
    PlatformAdminReactivateOrganizationUseCase,
    PlatformAdminDeleteOrganizationUseCase,
    PlatformAdminRestoreOrganizationUseCase,
    PlatformAdminTransferOrganizationOwnershipUseCase,
    SearchOrganizationsUseCase,
    ListOrganizationMembersUseCase,
    ChangeOrganizationMemberRoleUseCase,
    RemoveOrganizationMemberUseCase,
    SelfServiceTransferOrganizationOwnershipUseCase,
    IssueOrganizationInvitationUseCase,
    ListOrganizationInvitationsUseCase,
    RevokeOrganizationInvitationUseCase,
    AcceptOrganizationInvitationUseCase,
    PrismaOrganizationRepository,
    PrismaOrganizationMemberRepository,
    PrismaOrganizationInvitationRepository,
    PrismaPlatformAdminOrganizationStatsReader,
    SmtpEmailProvider,
    { provide: ORGANIZATION_REPOSITORY, useExisting: PrismaOrganizationRepository },
    { provide: ORGANIZATION_MEMBER_REPOSITORY, useExisting: PrismaOrganizationMemberRepository },
    {
      provide: ORGANIZATION_INVITATION_REPOSITORY,
      useExisting: PrismaOrganizationInvitationRepository,
    },
    { provide: EMAIL_PROVIDER, useExisting: SmtpEmailProvider },
    {
      provide: PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
      useExisting: PrismaPlatformAdminOrganizationStatsReader,
    },
  ],
  // PLATFORM_ADMIN_ORGANIZATION_STATS_READER is exported for PlatformAdminModule
  // (Phase 19 — Platform Dashboard composition endpoint, ADR-035 Pattern 2):
  // a platform-wide Organization status count, the same cross-module reuse
  // shape RestaurantsModule already established for
  // PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER.
  exports: [
    ORGANIZATION_REPOSITORY,
    ORGANIZATION_MEMBER_REPOSITORY,
    PLATFORM_ADMIN_ORGANIZATION_STATS_READER,
  ],
})
export class OrganizationsModule {}
