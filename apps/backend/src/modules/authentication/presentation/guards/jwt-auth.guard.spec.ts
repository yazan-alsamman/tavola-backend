import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { TokenExpiredError } from 'jsonwebtoken';
import { JwtAuthGuard } from './jwt-auth.guard';
import {
  AUTHENTICATED_ACTOR_KEY,
  AuthenticatedUserActor,
} from '../../application/dto/authenticated-actor.dto';
import {
  ExpiredAccessTokenException,
  InvalidAccessTokenException,
  MissingAccessTokenException,
} from '../../application/exceptions/access-token.exceptions';
import { AccessTokenActorType, AccessTokenClaims } from '../../domain/services/access-token-claims';
import { TokenService } from '../../domain/services/token-service.port';
import {
  CollectingAuditLogWriter,
  FakeTokenService,
} from '../../../../../test/authentication/support/in-memory-registration.dependencies';

describe('JwtAuthGuard', () => {
  const userId = '11111111-1111-4111-8111-111111111111';
  const sessionId = '33333333-3333-4333-8333-333333333333';

  class ThrowingTokenService implements TokenService {
    signAccessToken(_claims: AccessTokenClaims): string {
      return 'invalid-token';
    }

    verifyAccessToken(_token: string): AccessTokenClaims {
      throw new Error('invalid signature');
    }
  }

  class ExpiredTokenService implements TokenService {
    signAccessToken(_claims: AccessTokenClaims): string {
      return 'expired-token';
    }

    verifyAccessToken(_token: string): AccessTokenClaims {
      throw new TokenExpiredError('jwt expired', new Date('2026-07-07T17:00:00.000Z'));
    }
  }

  function createExecutionContext(headers: Record<string, string | undefined> = {}) {
    const request: Record<string, unknown> = { headers, ip: '203.0.113.20', socket: {} };

    const context = {
      switchToHttp: () => ({
        getRequest: () => request,
      }),
    } as ExecutionContext;

    return { context, request };
  }

  it('allows access and attaches the authenticated actor for a valid token', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(new FakeTokenService(), auditLogWriter);
    const token = `jwt.${userId}.${sessionId}`;
    const { context, request } = createExecutionContext({
      authorization: `Bearer ${token}`,
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);

    const actor = request[AUTHENTICATED_ACTOR_KEY] as AuthenticatedUserActor;
    expect(actor).toEqual({
      actorType: AccessTokenActorType.User,
      userId,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
    });
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('rejects requests without an authorization header and does not audit it', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(new FakeTokenService(), auditLogWriter);
    const { context } = createExecutionContext();

    await expect(guard.canActivate(context)).rejects.toThrow(MissingAccessTokenException);
    expect(auditLogWriter.entries).toHaveLength(0);
  });

  it('rejects malformed authorization headers', async () => {
    const guard = new JwtAuthGuard(new FakeTokenService(), new CollectingAuditLogWriter());

    await expect(
      guard.canActivate(createExecutionContext({ authorization: 'Token abc' }).context),
    ).rejects.toThrow(MissingAccessTokenException);

    await expect(
      guard.canActivate(createExecutionContext({ authorization: 'Bearer   ' }).context),
    ).rejects.toThrow(MissingAccessTokenException);
  });

  it('rejects tokens with an invalid signature and audits auth.jwt.invalid', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(new ThrowingTokenService(), auditLogWriter);
    const { context } = createExecutionContext({
      authorization: 'Bearer invalid-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(InvalidAccessTokenException);
    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0]).toMatchObject({
      action: 'auth.jwt.invalid',
      actorId: null,
      ipAddress: '203.0.113.20',
    });
  });

  it('rejects expired tokens and audits auth.jwt.expired', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(new ExpiredTokenService(), auditLogWriter);
    const { context } = createExecutionContext({
      authorization: 'Bearer expired-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ExpiredAccessTokenException);
    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0].action).toBe('auth.jwt.expired');
  });

  it('attaches an Employee actor with resolved permissions for Employee claims', async () => {
    const claims: AccessTokenClaims = {
      sub: userId,
      actorType: AccessTokenActorType.Employee,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: 'restaurant-1',
      branchIds: ['branch-1'],
      permissions: ['reservations:approve'],
      permissionsVersion: 3,
    };
    const guard = new JwtAuthGuard(
      {
        signAccessToken: () => 'employee-token',
        verifyAccessToken: () => claims,
      },
      new CollectingAuditLogWriter(),
    );
    const { context, request } = createExecutionContext({
      authorization: 'Bearer employee-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[AUTHENTICATED_ACTOR_KEY]).toEqual({
      actorType: AccessTokenActorType.Employee,
      userId,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
      employeeId: 'employee-1',
      organizationId: 'org-1',
      restaurantId: 'restaurant-1',
      branchIds: ['branch-1'],
      permissions: ['reservations:approve'],
      permissionsVersion: 3,
    });
  });

  it('attaches an OrganizationMember actor for OrganizationMember claims', async () => {
    const claims: AccessTokenClaims = {
      sub: userId,
      actorType: AccessTokenActorType.OrganizationMember,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
      organizationId: 'org-1',
      orgRole: 'Owner',
      permissionsVersion: 1,
    };
    const guard = new JwtAuthGuard(
      {
        signAccessToken: () => 'org-member-token',
        verifyAccessToken: () => claims,
      },
      new CollectingAuditLogWriter(),
    );
    const { context, request } = createExecutionContext({
      authorization: 'Bearer org-member-token',
    });

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request[AUTHENTICATED_ACTOR_KEY]).toEqual({
      actorType: AccessTokenActorType.OrganizationMember,
      userId,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
      organizationId: 'org-1',
      orgRole: 'Owner',
      permissionsVersion: 1,
    });
  });

  it('rejects PlatformAdmin claims - no request-actor shape exists for them yet', async () => {
    const claims: AccessTokenClaims = {
      sub: userId,
      actorType: AccessTokenActorType.PlatformAdmin,
      sessionId,
      sessionVersion: 1,
      tokenFamilyId: 'family-id',
    };
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(
      {
        signAccessToken: () => 'platform-admin-token',
        verifyAccessToken: () => claims,
      },
      auditLogWriter,
    );
    const { context } = createExecutionContext({
      authorization: 'Bearer platform-admin-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(InvalidAccessTokenException);
    expect(auditLogWriter.entries).toHaveLength(1);
    expect(auditLogWriter.entries[0].action).toBe('auth.jwt.invalid');
  });

  it('maps unauthorized exceptions with no cause at all to auth.jwt.invalid', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(
      {
        signAccessToken: () => 'token',
        verifyAccessToken: () => {
          throw new UnauthorizedException('Unauthorized');
        },
      },
      auditLogWriter,
    );
    const { context } = createExecutionContext({
      authorization: 'Bearer no-cause-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(InvalidAccessTokenException);
    expect(auditLogWriter.entries[0].action).toBe('auth.jwt.invalid');
  });

  it('maps unauthorized exceptions with a non-expiry cause to auth.jwt.invalid', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(
      {
        signAccessToken: () => 'token',
        verifyAccessToken: () => {
          throw new UnauthorizedException('Unauthorized', {
            cause: new Error('signature mismatch'),
          });
        },
      },
      auditLogWriter,
    );
    const { context } = createExecutionContext({
      authorization: 'Bearer tampered-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(InvalidAccessTokenException);
    expect(auditLogWriter.entries[0].action).toBe('auth.jwt.invalid');
  });

  it('maps unauthorized exceptions caused by token expiry', async () => {
    const auditLogWriter = new CollectingAuditLogWriter();
    const guard = new JwtAuthGuard(
      {
        signAccessToken: () => 'token',
        verifyAccessToken: () => {
          throw new UnauthorizedException('Unauthorized', {
            cause: new TokenExpiredError('jwt expired', new Date('2026-07-07T17:00:00.000Z')),
          });
        },
      },
      auditLogWriter,
    );
    const { context } = createExecutionContext({
      authorization: 'Bearer expired-token',
    });

    await expect(guard.canActivate(context)).rejects.toThrow(ExpiredAccessTokenException);
    expect(auditLogWriter.entries[0].action).toBe('auth.jwt.expired');
  });
});
