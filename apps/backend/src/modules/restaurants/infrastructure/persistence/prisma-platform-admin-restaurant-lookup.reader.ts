import { Injectable } from '@nestjs/common';
import { PrismaService } from '@infrastructure/prisma/prisma.service';
import {
  PlatformAdminRestaurantLookup,
  PlatformAdminRestaurantLookupReaderPort,
} from '../../application/ports/platform-admin-restaurant-lookup-reader.port';

/**
 * ADR-035 Pattern 2 — deliberately injects the raw `PrismaService` instead of
 * `PrismaContext`, mirroring `PrismaRestaurantDirectoryReader`/
 * `PrismaDiscoveryReader`'s own justification: no single `organizationId` can
 * be bound yet, because discovering which Organization owns this Restaurant
 * id IS the read this class exists to perform. Added by name to
 * `.eslintrc.js`'s `no-restricted-imports` `excludedFiles` whitelist.
 *
 * Unlike those three existing readers (all customer-facing, all structurally
 * exclude `organizationId` from their response), this one is the Platform
 * Back Office case ADR-035 §3 calls out explicitly: it MUST include
 * `organizationId`, since finding it is the entire point — the caller
 * (a PlatformAdmin Restaurant lifecycle use case) immediately uses it to
 * Explicit-Tenant-Rebind (Pattern 1) before performing any actual mutation.
 * Read-only; includes soft-deleted restaurants (Restore needs to find one).
 */
@Injectable()
export class PrismaPlatformAdminRestaurantLookupReader implements PlatformAdminRestaurantLookupReaderPort {
  constructor(private readonly prisma: PrismaService) {}

  async findOrganizationIdByRestaurantId(
    restaurantId: string,
  ): Promise<PlatformAdminRestaurantLookup | null> {
    const row = await this.prisma.restaurant.findUnique({
      where: { id: restaurantId },
      select: { id: true, organizationId: true },
    });
    return row ? { restaurantId: row.id, organizationId: row.organizationId } : null;
  }
}
