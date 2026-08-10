import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { PlatformAdminController } from './presentation/controllers/platform-admin.controller';
import { PlatformAdminAccountsController } from './presentation/controllers/platform-admin-accounts.controller';
import { PlatformAdminAuditLogsController } from './presentation/controllers/platform-admin-audit-logs.controller';
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
 */
@Module({
  imports: [PrismaModule, forwardRef(() => AuthenticationModule)],
  controllers: [
    PlatformAdminController,
    PlatformAdminAccountsController,
    PlatformAdminAuditLogsController,
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
