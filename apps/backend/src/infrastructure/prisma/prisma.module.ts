import { Global, Module } from '@nestjs/common';
import { PrismaService } from './prisma.service';

/**
 * Global so every future module's repository can inject PrismaService
 * without re-importing PrismaModule everywhere - matches how ARCHITECTURE.md
 * describes the Infrastructure layer as shared foundation, not a per-feature
 * concern.
 *
 * `PrismaContext` (the tenant-scoped, transaction-aware client every
 * repository is expected to inject) is registered by `TenancyModule`
 * instead of here, since it now depends on `TenantContextService` -
 * `TenancyModule` already imports this module for the raw `PrismaService`,
 * so registering it there avoids a circular module dependency (Phase
 * 2.13.1). Both modules are `@Global()`, so this move is transparent to
 * every existing consumer.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class PrismaModule {}
