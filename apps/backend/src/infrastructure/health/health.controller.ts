import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { SkipResponseEnvelope } from '../../common/decorators/skip-response-envelope.decorator';
import { PrismaHealthIndicator } from './indicators/prisma.health-indicator';
import { RedisHealthIndicator } from './indicators/redis.health-indicator';
import { MinioHealthIndicator } from './indicators/minio.health-indicator';

/**
 * NON_FUNCTIONAL_REQUIREMENTS.md requires /health, /health/readiness, and
 * /health/liveness, each verifying PostgreSQL, Redis, and MinIO and
 * returning detailed per-dependency status. Deliberately unauthenticated
 * and excluded from the response envelope (@SkipResponseEnvelope) - these
 * are infrastructure-facing endpoints with their own required contract
 * (Terminus's { status, info, details } shape), not business API responses.
 *
 * /health/liveness never checks external dependencies (only "is the process
 * responding"), per ENVIRONMENT_SETUP.md's rule that a downstream failure
 * must not cause the container to be killed - that is what /readiness is
 * for, to pull the instance out of the load balancer without restarting it.
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaHealthIndicator: PrismaHealthIndicator,
    private readonly redisHealthIndicator: RedisHealthIndicator,
    private readonly minioHealthIndicator: MinioHealthIndicator,
  ) {}

  @Get()
  @HealthCheck()
  @SkipResponseEnvelope()
  check() {
    return this.health.check([
      () => this.prismaHealthIndicator.isHealthy('database'),
      () => this.redisHealthIndicator.isHealthy('redis'),
      () => this.minioHealthIndicator.isHealthy('minio'),
    ]);
  }

  @Get('liveness')
  @HealthCheck()
  @SkipResponseEnvelope()
  liveness() {
    return this.health.check([]);
  }

  @Get('readiness')
  @HealthCheck()
  @SkipResponseEnvelope()
  readiness() {
    return this.health.check([
      () => this.prismaHealthIndicator.isHealthy('database'),
      () => this.redisHealthIndicator.isHealthy('redis'),
      () => this.minioHealthIndicator.isHealthy('minio'),
    ]);
  }
}
