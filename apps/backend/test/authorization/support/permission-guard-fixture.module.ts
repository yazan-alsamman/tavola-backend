import { Controller, Get, Module, UseGuards } from '@nestjs/common';
import { AuthenticationModule } from '@modules/authentication/authentication.module';
import { AuthorizationModule } from '@modules/authorization/authorization.module';
import { AuthenticatedActor } from '@modules/authentication/application/dto/authenticated-actor.dto';
import { CurrentActor } from '@modules/authentication/presentation/decorators/current-actor.decorator';
import { JwtAuthGuard } from '@modules/authentication/presentation/guards/jwt-auth.guard';
import { SessionVersionGuard } from '@modules/authentication/presentation/guards/session-version.guard';
import { PermissionsGuard } from '@modules/authorization/presentation/guards/permissions.guard';
import { RequirePermission } from '@modules/authorization/presentation/decorators/require-permission.decorator';

/**
 * Phase 2.15 - proves `@RequirePermission`/`PermissionsGuard` end to end
 * against real signed JWTs without adding a throwaway route to any
 * production controller (no permission-protected business endpoint exists
 * yet - Restaurants/Reservations/etc. are all future phases). Mounted only
 * by e2e tests via `createTestApp([PermissionGuardFixtureModule])`, never by
 * the real `AppModule`.
 */
@Controller({ path: 'test/permissions', version: '1' })
class PermissionGuardFixtureController {
  @Get('reservations-approve')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('reservations:approve')
  reservationsApprove(@CurrentActor() actor: AuthenticatedActor) {
    return { ok: true, actorType: actor.actorType };
  }

  @Get('tables-manage')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  @RequirePermission('tables:manage')
  tablesManage(@CurrentActor() actor: AuthenticatedActor) {
    return { ok: true, actorType: actor.actorType };
  }

  @Get('no-metadata')
  @UseGuards(JwtAuthGuard, SessionVersionGuard, PermissionsGuard)
  noMetadata() {
    return { ok: true };
  }

  @Get('authenticated-only')
  @UseGuards(JwtAuthGuard, SessionVersionGuard)
  authenticatedOnly(@CurrentActor() actor: AuthenticatedActor) {
    return { ok: true, actorType: actor.actorType };
  }
}

@Module({
  imports: [AuthenticationModule, AuthorizationModule],
  controllers: [PermissionGuardFixtureController],
})
export class PermissionGuardFixtureModule {}
