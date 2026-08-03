import { forwardRef, Module } from '@nestjs/common';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { PlatformAdminController } from './presentation/controllers/platform-admin.controller';
import { PlatformAdminGuard } from './presentation/guards/platform-admin.guard';
import { PlatformAdminLoginUseCase } from './application/use-cases/platform-admin-login.use-case';
import { JwtPlatformAdminTokenService } from './infrastructure/security/jwt-platform-admin-token.service';
import { PrismaPlatformAdminRepository } from './infrastructure/persistence/prisma-platform-admin.repository';
import { PLATFORM_ADMIN_REPOSITORY } from './domain/repositories/platform-admin.repository';
import { PLATFORM_ADMIN_TOKEN_SERVICE } from './domain/services/platform-admin-token.port';

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
  controllers: [PlatformAdminController],
  providers: [
    PlatformAdminGuard,
    PlatformAdminLoginUseCase,
    JwtPlatformAdminTokenService,
    PrismaPlatformAdminRepository,
    { provide: PLATFORM_ADMIN_REPOSITORY, useExisting: PrismaPlatformAdminRepository },
    { provide: PLATFORM_ADMIN_TOKEN_SERVICE, useExisting: JwtPlatformAdminTokenService },
  ],
  exports: [PlatformAdminGuard, PLATFORM_ADMIN_REPOSITORY, PLATFORM_ADMIN_TOKEN_SERVICE],
})
export class PlatformAdminModule {}
