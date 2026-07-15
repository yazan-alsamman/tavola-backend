import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { Logger } from 'nestjs-pino';

/**
 * Foundation-phase PrismaService: connection lifecycle only. The tenant-
 * scoped Prisma Client Extension (ADR-012, TENANCY.md) is deliberately not
 * implemented here - it requires the Organization concept and
 * TenantContextService, neither of which exist until the Organizations
 * module lands. Every future repository is expected to inject THIS service
 * (or its eventual tenant-scoped extension, once added) rather than
 * instantiating its own PrismaClient.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor(private readonly logger: Logger) {
    super();
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log(`[${PrismaService.name}] Connected to PostgreSQL`);
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
