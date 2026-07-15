import { Global, Module } from '@nestjs/common';
import { APP_INTERCEPTOR } from '@nestjs/core';
import { PrismaModule } from '@infrastructure/prisma/prisma.module';
import { PrismaContext } from '@infrastructure/prisma/prisma-context.service';
import { TENANT_CONTEXT_PORT } from '@shared/application/ports/tenant-context.port';
import { TenantContextService } from './tenant-context.service';
import { TenantContextInterceptor } from './tenant-context.interceptor';

/**
 * `@Global()` so every module can inject `TenantContextService` and
 * `PrismaContext` without explicitly importing this module — consistent
 * with how `PrismaModule` itself is global.
 *
 * `PrismaContext` is registered here (not in `PrismaModule`) because it now
 * depends on `TenantContextService` to build the tenant-scoped client every
 * repository transparently receives (Phase 2.13.1) - see `PrismaContext`'s
 * own doc comment for why the two concerns had to be unified rather than
 * kept as separate, independently-injectable clients.
 */
@Global()
@Module({
  imports: [PrismaModule],
  providers: [
    TenantContextService,
    PrismaContext,
    { provide: APP_INTERCEPTOR, useClass: TenantContextInterceptor },
    { provide: TENANT_CONTEXT_PORT, useExisting: TenantContextService },
  ],
  exports: [TenantContextService, PrismaContext, TENANT_CONTEXT_PORT],
})
export class TenancyModule {}
