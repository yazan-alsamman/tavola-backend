import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import {
  AuthRateLimitPolicyPort,
  RateLimitPolicyConfig,
  RateLimitPolicyName,
} from '../../application/ports/auth-rate-limit-policy.port';
import { RateLimitExceededException } from '../../domain/exceptions/rate-limit-exceeded.exception';
import { RateLimitDecision, RateLimiterPort } from '../../domain/services/rate-limiter.port';
import { RateLimit } from '../decorators/rate-limit.decorator';
import { RateLimitGuard } from './rate-limit.guard';
import { CollectingAuditLogWriter } from '../../../../../test/authentication/support/in-memory-registration.dependencies';
import { AUTHENTICATED_ACTOR_KEY } from '../../application/dto/authenticated-actor.dto';

class TestController {
  @RateLimit('login')
  loginHandler() {
    return null;
  }

  @RateLimit('forgotPassword')
  forgotPasswordHandler() {
    return null;
  }

  @RateLimit('refresh')
  refreshHandler() {
    return null;
  }

  @RateLimit('resetPassword')
  resetPasswordHandler() {
    return null;
  }

  @RateLimit('register')
  registerHandler() {
    return null;
  }

  @RateLimit('changePassword')
  changePasswordHandler() {
    return null;
  }

  unprotectedHandler() {
    return null;
  }
}

describe('RateLimitGuard', () => {
  const reflector = new Reflector();
  const controller = new TestController();
  const policy: RateLimitPolicyConfig = { max: 10, windowSeconds: 900 };

  function createContext(
    handler: () => unknown,
    body: Record<string, unknown> = {},
    actor?: Record<string, unknown>,
  ): ExecutionContext {
    const request = {
      body,
      headers: {},
      ip: '198.51.100.7',
      socket: {},
      ...(actor !== undefined ? { [AUTHENTICATED_ACTOR_KEY]: actor } : {}),
    } as unknown as Request;
    return {
      getHandler: () => handler,
      getClass: () => TestController,
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function createGuard(decision: RateLimitDecision) {
    const consume = jest.fn().mockResolvedValue(decision);
    const rateLimiter: RateLimiterPort = { consume };
    const policyPort: AuthRateLimitPolicyPort = {
      getPolicy: (_name: RateLimitPolicyName) => policy,
    };
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new RateLimitGuard(reflector, rateLimiter, policyPort, auditLogWriter);
    return { guard, consume, auditLogWriter };
  }

  const allowedDecision: RateLimitDecision = {
    allowed: true,
    remaining: 9,
    resetAt: new Date('2026-01-01T00:15:00.000Z'),
  };
  const blockedDecision: RateLimitDecision = {
    allowed: false,
    remaining: 0,
    resetAt: new Date('2026-01-01T00:15:00.000Z'),
  };

  it('allows the request through when under the limit', async () => {
    const { guard } = createGuard(allowedDecision);
    const context = createContext(controller.loginHandler, { email: 'a@example.com' });
    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('throws RateLimitExceededException once the limit is reached and audits it', async () => {
    const { guard, auditLogWriter } = createGuard(blockedDecision);
    const context = createContext(controller.loginHandler, { email: 'a@example.com' });
    await expect(guard.canActivate(context)).rejects.toThrow(RateLimitExceededException);

    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.rate_limit.exceeded',
      targetType: 'RateLimitPolicy',
      targetId: 'login',
      ipAddress: '198.51.100.7',
    });
  });

  it('does not audit an allowed request', async () => {
    const { guard, auditLogWriter } = createGuard(allowedDecision);
    const context = createContext(controller.loginHandler, { email: 'a@example.com' });
    await guard.canActivate(context);
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('throws a misconfiguration error when no @RateLimit metadata is present', async () => {
    const { guard } = createGuard(allowedDecision);
    const context = createContext(controller.unprotectedHandler);
    await expect(guard.canActivate(context)).rejects.toThrow(
      'RateLimitGuard applied without a @RateLimit(...) policy.',
    );
  });

  it('keys the login policy by client IP, not by request body', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.loginHandler, { email: 'someone@example.com' });
    await guard.canActivate(context);

    expect(consume).toHaveBeenCalledTimes(1);
    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:login:[a-f0-9]{64}$/);
  });

  it('keys the forgotPassword policy by normalized email', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const contextUpper = createContext(controller.forgotPasswordHandler, {
      email: 'Someone@Example.com',
    });
    const contextLower = createContext(controller.forgotPasswordHandler, {
      email: '  someone@example.com  ',
    });

    await guard.canActivate(contextUpper);
    await guard.canActivate(contextLower);

    const [firstKey] = consume.mock.calls[0];
    const [secondKey] = consume.mock.calls[1];
    expect(firstKey).toBe(secondKey);
  });

  it('keys the resetPassword policy by client IP, same as login', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.resetPasswordHandler, { token: 'some-token' });
    await guard.canActivate(context);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:resetPassword:[a-f0-9]{64}$/);
  });

  it('keys the register policy by client IP, same as login', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.registerHandler, { email: 'owner@example.com' });
    await guard.canActivate(context);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:register:[a-f0-9]{64}$/);
  });

  it('keys the refresh policy by the presented refresh token, not the client IP', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.refreshHandler, { refreshToken: 'opaque-token-1' });
    await guard.canActivate(context);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:refresh:[a-f0-9]{64}$/);
  });

  it('buckets a missing email under a shared "unknown" key rather than throwing', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.forgotPasswordHandler, {});
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:forgotPassword:[a-f0-9]{64}$/);
  });

  it('buckets a non-string forged email under the same "unknown" key', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.forgotPasswordHandler, { email: { forged: true } });
    await guard.canActivate(context);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:forgotPassword:[a-f0-9]{64}$/);
  });

  it('buckets a missing refresh token under a shared "unknown" key rather than throwing', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.refreshHandler, {});
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:refresh:[a-f0-9]{64}$/);
  });

  it('keys the changePassword policy by authenticated userId, not client IP', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.changePasswordHandler, {}, { userId: 'user-1' });
    await guard.canActivate(context);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:changePassword:[a-f0-9]{64}$/);
  });

  it('gives two different authenticated users distinct changePassword keys', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const contextA = createContext(controller.changePasswordHandler, {}, { userId: 'user-a' });
    const contextB = createContext(controller.changePasswordHandler, {}, { userId: 'user-b' });

    await guard.canActivate(contextA);
    await guard.canActivate(contextB);

    const [firstKey] = consume.mock.calls[0];
    const [secondKey] = consume.mock.calls[1];
    expect(firstKey).not.toBe(secondKey);
  });

  it('buckets a missing authenticated actor under a shared "unknown" key rather than throwing', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.changePasswordHandler, {});
    await expect(guard.canActivate(context)).resolves.toBe(true);

    const [key] = consume.mock.calls[0];
    expect(key).toMatch(/^auth:ratelimit:changePassword:[a-f0-9]{64}$/);
  });

  it('passes the configured max and windowSeconds through to the limiter', async () => {
    const { guard, consume } = createGuard(allowedDecision);
    const context = createContext(controller.loginHandler, { email: 'a@example.com' });
    await guard.canActivate(context);

    const [, max, windowSeconds] = consume.mock.calls[0];
    expect(max).toBe(policy.max);
    expect(windowSeconds).toBe(policy.windowSeconds);
  });
});
