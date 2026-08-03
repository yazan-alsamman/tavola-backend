import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { RateLimitExceededException } from '@modules/authentication/domain/exceptions/rate-limit-exceeded.exception';
import {
  RateLimitDecision,
  RateLimiterPort,
} from '@modules/authentication/domain/services/rate-limiter.port';
import { CollectingAuditLogWriter } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { DiscoveryRateLimitGuard } from './discovery-rate-limit.guard';

describe('DiscoveryRateLimitGuard (D12)', () => {
  const policy = { max: 60, windowSeconds: 60 };

  function createContext(ip: string): ExecutionContext {
    const request = { headers: {}, ip, socket: {} } as unknown as Request;
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function createGuard(decision: RateLimitDecision) {
    const consume = jest.fn().mockResolvedValue(decision);
    const rateLimiter: RateLimiterPort = { consume };
    const auditLogWriter = new CollectingAuditLogWriter();
    const configService = { get: () => ({ rateLimit: policy }) } as unknown as ConfigService;
    const guard = new DiscoveryRateLimitGuard(rateLimiter, auditLogWriter, configService);
    return { guard, consume, auditLogWriter };
  }

  const allowedDecision: RateLimitDecision = {
    allowed: true,
    remaining: 59,
    resetAt: new Date('2026-01-01T00:01:00.000Z'),
  };
  const blockedDecision: RateLimitDecision = {
    allowed: false,
    remaining: 0,
    resetAt: new Date('2026-01-01T00:01:00.000Z'),
  };

  it('allows the request through when under the limit', async () => {
    const { guard } = createGuard(allowedDecision);
    await expect(guard.canActivate(createContext('198.51.100.7'))).resolves.toBe(true);
  });

  it('throws RateLimitExceededException once the limit is reached and audits it', async () => {
    const { guard, auditLogWriter } = createGuard(blockedDecision);
    await expect(guard.canActivate(createContext('198.51.100.7'))).rejects.toThrow(
      RateLimitExceededException,
    );

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'discovery.rate_limit.exceeded',
      targetType: 'DiscoveryRateLimitPolicy',
      targetId: 'public',
      ipAddress: '198.51.100.7',
    });
  });

  it('does not audit an allowed request', async () => {
    const { guard, auditLogWriter } = createGuard(allowedDecision);
    await guard.canActivate(createContext('198.51.100.7'));
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('keys the bucket by client IP (SHA-256 hashed), same convention as Authentication', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    await guard.canActivate(createContext('198.51.100.7'));

    expect(consume).toHaveBeenCalledTimes(1);
    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^discovery:ratelimit:public:[a-f0-9]{64}$/);
  });

  it('gives two different client IPs distinct keys', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    await guard.canActivate(createContext('198.51.100.7'));
    await guard.canActivate(createContext('203.0.113.9'));

    const [firstKey] = consume.mock.calls[0];
    const [secondKey] = consume.mock.calls[1];
    expect(firstKey).not.toBe(secondKey);
  });

  it('passes the configured max and windowSeconds through to the limiter', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    await guard.canActivate(createContext('198.51.100.7'));

    const [, max, windowSeconds] = consume.mock.calls[0];
    expect(max).toBe(policy.max);
    expect(windowSeconds).toBe(policy.windowSeconds);
  });

  it('propagates a Redis/limiter failure as an error rather than silently allowing the request (fails closed, D12)', async () => {
    const rateLimiter: RateLimiterPort = {
      consume: jest.fn().mockRejectedValue(new Error('redis unavailable')),
    };
    const auditLogWriter = new CollectingAuditLogWriter();
    const configService = { get: () => ({ rateLimit: policy }) } as unknown as ConfigService;
    const guard = new DiscoveryRateLimitGuard(rateLimiter, auditLogWriter, configService);

    await expect(guard.canActivate(createContext('198.51.100.7'))).rejects.toThrow(
      'redis unavailable',
    );
  });
});
