import * as jwt from 'jsonwebtoken';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminGuard } from './platform-admin.guard';
import { JwtPlatformAdminTokenService } from '../../infrastructure/security/jwt-platform-admin-token.service';
import { PlatformAdminRepository } from '../../domain/repositories/platform-admin.repository';

/**
 * ADR-022 §"Platform Admin Authentication" (Phase 2.23 closure) - security-
 * critical isolation proof. Every scenario here uses the REAL
 * `JwtPlatformAdminTokenService` (not a mock) so the secret/issuer/audience
 * isolation is genuinely exercised, not merely asserted.
 */
describe('PlatformAdminGuard — token isolation', () => {
  const platformAdminSecret = 'platform-admin-secret-at-least-32-characters-long';
  const platformAdminIssuer = 'tavla-platform-admin';
  const platformAdminAudience = 'tavla-platform-admin-clients';

  const ordinarySecret = 'ordinary-tenant-secret-at-least-32-characters-long';
  const ordinaryIssuer = 'tavla-api';
  const ordinaryAudience = 'tavla-clients';

  const adminUserId = '11111111-1111-4111-8111-111111111111';

  function buildConfigService(): ConfigService {
    return {
      get: () => ({
        jwtSecret: platformAdminSecret,
        jwtIssuer: platformAdminIssuer,
        jwtAudience: platformAdminAudience,
        jwtExpirySeconds: 900,
      }),
    } as unknown as ConfigService;
  }

  class FakePlatformAdminRepository implements PlatformAdminRepository {
    constructor(private readonly activeAdminIds: Set<string> = new Set([adminUserId])) {}
    async isActiveAdmin(userId: string): Promise<boolean> {
      return this.activeAdminIds.has(userId);
    }
  }

  function buildContext(authorizationHeader?: string): ExecutionContext {
    const request = { headers: { authorization: authorizationHeader } };
    return {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
  }

  function issueRealPlatformAdminToken(subject: string): string {
    const tokenService = new JwtPlatformAdminTokenService(buildConfigService());
    return tokenService.signAccessToken({ sub: subject });
  }

  function issueOrdinaryToken(actorType: string, subject: string): string {
    // Simulates a genuine Owner/Employee/Customer/OrganizationMember token
    // - signed under the completely different ordinary tenant secret/
    // issuer/audience, exactly like `JwtTokenService` would produce.
    return jwt.sign(
      { sub: subject, actorType, sessionId: 's1', sessionVersion: 1, tokenFamilyId: 'f1' },
      ordinarySecret,
      {
        algorithm: 'HS256',
        expiresIn: '15m',
        issuer: ordinaryIssuer,
        audience: ordinaryAudience,
      },
    );
  }

  function createGuard(repository: PlatformAdminRepository = new FakePlatformAdminRepository()) {
    return new PlatformAdminGuard(
      new JwtPlatformAdminTokenService(buildConfigService()),
      repository,
    );
  }

  it('1. accepts a valid Platform Admin token for an active admin', async () => {
    const guard = createGuard();
    const token = issueRealPlatformAdminToken(adminUserId);
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).resolves.toBe(true);
  });

  it('2. rejects a normal Owner token (signed under the ordinary issuer/audience/secret)', async () => {
    const guard = createGuard();
    const token = issueOrdinaryToken('OrganizationMember', adminUserId);
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('3. rejects a normal Employee token', async () => {
    const guard = createGuard();
    const token = issueOrdinaryToken('Employee', adminUserId);
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('4. rejects a normal Customer token', async () => {
    const guard = createGuard();
    const token = issueOrdinaryToken('User', adminUserId);
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('5. rejects a token with the correct secret/audience but the WRONG issuer', async () => {
    const guard = createGuard();
    const token = jwt.sign({ sub: adminUserId }, platformAdminSecret, {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: 'not-the-real-issuer',
      audience: platformAdminAudience,
    });
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('6. rejects a token with the correct secret/issuer but the WRONG audience', async () => {
    const guard = createGuard();
    const token = jwt.sign({ sub: adminUserId }, platformAdminSecret, {
      algorithm: 'HS256',
      expiresIn: '15m',
      issuer: platformAdminIssuer,
      audience: 'not-the-real-audience',
    });
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('7. rejects an expired Platform Admin token', async () => {
    const guard = createGuard();
    const token = jwt.sign({ sub: adminUserId }, platformAdminSecret, {
      algorithm: 'HS256',
      expiresIn: -10,
      issuer: platformAdminIssuer,
      audience: platformAdminAudience,
    });
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('8. rejects a nonexistent/revoked Platform Admin even with an otherwise-valid token', async () => {
    const guard = createGuard(new FakePlatformAdminRepository(new Set()));
    const token = issueRealPlatformAdminToken(adminUserId);
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('9. rejects a forged token carrying actorType=PlatformAdmin but signed under the ordinary issuer/audience/secret', async () => {
    const guard = createGuard();
    const token = issueOrdinaryToken('PlatformAdmin', adminUserId);
    const context = buildContext(`Bearer ${token}`);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a missing Authorization header', async () => {
    const guard = createGuard();
    const context = buildContext(undefined);

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('rejects a malformed Authorization header', async () => {
    const guard = createGuard();
    const context = buildContext('NotBearer sometoken');

    await expect(guard.canActivate(context)).rejects.toThrow(ForbiddenException);
  });
});
