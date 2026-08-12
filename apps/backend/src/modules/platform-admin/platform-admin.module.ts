import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { RestaurantsModule } from '@modules/restaurants/restaurants.module';
import { OrganizationsModule } from '@modules/organizations/organizations.module';
import { SubscriptionsModule } from '@modules/subscriptions/subscriptions.module';
import { CustomerAcquisitionModule } from '@modules/customer-acquisition/customer-acquisition.module';
import { NotificationsModule } from '@modules/notifications/notifications.module';
import { PlatformAdminController } from './presentation/controllers/platform-admin.controller';
import { PlatformAdminAccountsController } from './presentation/controllers/platform-admin-accounts.controller';
import { PlatformAdminAuditLogsController } from './presentation/controllers/platform-admin-audit-logs.controller';
import { PlatformAdminDashboardController } from './presentation/controllers/platform-admin-dashboard.controller';
import { PlatformAdminGuard } from './presentation/guards/platform-admin.guard';
import { PlatformAdminRoleGuard } from './presentation/guards/platform-admin-role.guard';
import { PlatformAdminLoginUseCase } from './application/use-cases/platform-admin-login.use-case';
import { CreatePlatformAdminUseCase } from './application/use-cases/create-platform-admin.use-case';
import { UpdatePlatformAdminRoleUseCase } from './application/use-cases/update-platform-admin-role.use-case';
import { DeactivatePlatformAdminUseCase } from './application/use-cases/deactivate-platform-admin.use-case';
import { ReactivatePlatformAdminUseCase } from './application/use-cases/reactivate-platform-admin.use-case';
import { ListPlatformAdminsUseCase } from './application/use-cases/list-platform-admins.use-case';
import { GetPlatformAdminUseCase } from './application/use-cases/get-platform-admin.use-case';
import { ListAuditLogsUseCase } from './application/use-cases/list-audit-logs.use-case';
import { GetPlatformDashboardUseCase } from './application/use-cases/get-platform-dashboard.use-case';
import { JwtPlatformAdminTokenService } from './infrastructure/security/jwt-platform-admin-token.service';
import { PrismaPlatformAdminRepository } from './infrastructure/persistence/prisma-platform-admin.repository';
import { PrismaAuditLogReader } from './infrastructure/persistence/prisma-audit-log.reader';
import { PLATFORM_ADMIN_REPOSITORY } from './domain/repositories/platform-admin.repository';
import { PLATFORM_ADMIN_TOKEN_SERVICE } from './domain/services/platform-admin-token.port';
import { AUDIT_LOG_READER } from './application/ports/audit-log-reader.port';

/**
 * ADR-022 §"Platform Admin Authentication" (Phase 2.23 closure). Imports
 * `AuthenticationModule` to reuse `ProvisionRestaurantOwnerUseCase` and the
 * shared User/PasswordHasher/LoginAttempt/Audit infrastructure for
 * `PlatformAdminLoginUseCase` - never `AuthenticationModule`'s
 * `JwtAuthGuard`/`TokenService`, which this module deliberately does not
 * use anywhere. Wrapped in `forwardRef` (Phase 12, ADR-027): `SubscriptionsModule`
 * imports this module for `PlatformAdminGuard`, while `AuthenticationModule`
 * imports `SubscriptionsModule` (also via `forwardRef`) - the same
 * three-module cycle documented on `RestaurantsModule`'s own
 * `AuthenticationModule` import.
 *
 * Phase 19 — Platform Dashboard composition endpoint: this module now also
 * imports `RestaurantsModule`/`OrganizationsModule`/`SubscriptionsModule`/
 * `CustomerAcquisitionModule` (all `forwardRef`, since each of those modules
 * already imports this one back for `PlatformAdminGuard`/`PlatformAdminRoleGuard`
 * - a genuine direct two-module cycle per edge, resolved the same way as the
 * `AuthenticationModule` cycle above) purely to inject their exported
 * Pattern-2 reader tokens (`PLATFORM_ADMIN_RESTAURANT_LOOKUP_READER`,
 * `PLATFORM_ADMIN_ORGANIZATION_STATS_READER`,
 * `PLATFORM_ADMIN_SUBSCRIPTION_STATS_READER`, `ACQUISITION_CROSS_TENANT_READER`)
 * into `GetPlatformDashboardUseCase` - no new repository, no new business
 * logic, pure composition (see that use case's own doc comment).
 *
 * Phase 19.6 — Platform Dashboard Messaging section: also imports
 * `NotificationsModule` (`forwardRef`, since it now imports this module back
 * for `PLATFORM_ADMIN_NOTIFICATION_STATS_READER` via its own
 * `AuthenticationModule` edge - see `NotificationsModule`'s own doc comment
 * for the exact three-module cycle this closes) purely to inject that token
 * into `GetPlatformDashboardUseCase`, closing the Messaging dependency
 * Phase 19.5 disclosed as unimplemented.
 */
@Module({
  imports: [
    PrismaModule,
    forwardRef(() => AuthenticationModule),
    forwardRef(() => RestaurantsModule),
    forwardRef(() => OrganizationsModule),
    forwardRef(() => SubscriptionsModule),
    forwardRef(() => CustomerAcquisitionModule),
    forwardRef(() => NotificationsModule),
  ],
  controllers: [
    PlatformAdminController,
    PlatformAdminAccountsController,
    PlatformAdminAuditLogsController,
    PlatformAdminDashboardController,
  ],
  providers: [
    PlatformAdminGuard,
    PlatformAdminRoleGuard,
    PlatformAdminLoginUseCase,
    CreatePlatformAdminUseCase,
    UpdatePlatformAdminRoleUseCase,
    DeactivatePlatformAdminUseCase,
    ReactivatePlatformAdminUseCase,
    ListPlatformAdminsUseCase,
    GetPlatformAdminUseCase,
    ListAuditLogsUseCase,
    GetPlatformDashboardUseCase,
    JwtPlatformAdminTokenService,
    PrismaPlatformAdminRepository,
    PrismaAuditLogReader,
    { provide: PLATFORM_ADMIN_REPOSITORY, useExisting: PrismaPlatformAdminRepository },
    { provide: PLATFORM_ADMIN_TOKEN_SERVICE, useExisting: JwtPlatformAdminTokenService },
    { provide: AUDIT_LOG_READER, useExisting: PrismaAuditLogReader },
  ],
  exports: [
    PlatformAdminGuard,
    PlatformAdminRoleGuard,
    PLATFORM_ADMIN_REPOSITORY,
    PLATFORM_ADMIN_TOKEN_SERVICE,
  ],
})
export class PlatformAdminModule {}
