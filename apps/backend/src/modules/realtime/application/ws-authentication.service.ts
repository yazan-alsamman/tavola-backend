import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { TokenExpiredError } from 'jsonwebtoken';
import { UserId } from '@shared/domain/value-objects/identifiers.vo';
import {
  AuthenticatedActor,
  AuthenticatedEmployeeActor,
  AuthenticatedOrganizationMemberActor,
  AuthenticatedUserActor,
} from '@modules/authentication/application/dto/authenticated-actor.dto';
import { AccessTokenActorType } from '@modules/authentication/domain/services/access-token-claims';
import { TokenService } from '@modules/authentication/domain/services/token-service.port';
import {
  TOKEN_SERVICE,
  USER_REPOSITORY,
} from '@modules/authentication/domain/tokens/authentication.tokens';
import { UserRepository } from '@modules/authentication/domain/repositories/authentication.repositories';
import { SessionPolicy } from '@modules/authentication/domain/services/authentication-policies';
import {
  ExpiredAccessTokenException,
  InvalidAccessTokenException,
  StaleSessionVersionException,
} from '@modules/authentication/application/exceptions/access-token.exceptions';

export interface WsAuthenticationResult {
  readonly actor: AuthenticatedActor;
  /** From the JWT's own `exp` claim; `null` only if the token carries none. */
  readonly expiresAt: Date | null;
}

/**
 * Phase 8 §10/§11 — handshake authentication. Deliberately NOT `JwtAuthGuard`/
 * `SessionVersionGuard` reused as-is: both are `ExecutionContext`-shaped
 * (`context.switchToHttp().getRequest()`), which a Socket.IO handshake is
 * not. This service reproduces their exact actor-construction and one-time
 * `sessionVersion` staleness check (AUTHENTICATION_ARCHITECTURE.md) against
 * the same `TokenService`/`UserRepository` ports, so WS and HTTP authenticate
 * identically without a second token format or a parallel guard hierarchy.
 *
 * Runs ONCE at handshake (§10) - not on every subsequent event on the same
 * socket. A `permissionsVersion`/role/branch-assignment change or a
 * `sessionVersion` bump therefore only takes effect at the socket's next
 * reconnect, identical to the existing ≤15 min JWT staleness window HTTP
 * already accepts - immediate cross-instance eviction remains explicitly
 * out of Phase 8 scope (§10/§24).
 */
@Injectable()
export class WsAuthenticationService {
  constructor(
    @Inject(TOKEN_SERVICE) private readonly tokenService: TokenService,
    @Inject(USER_REPOSITORY) private readonly userRepository: UserRepository,
  ) {}

  async authenticate(rawToken: string | undefined | null): Promise<WsAuthenticationResult> {
    if (!rawToken || rawToken.trim().length === 0) {
      throw new InvalidAccessTokenException();
    }

    const claims = this.verifyAccessToken(rawToken);

    const base = {
      userId: claims.sub,
      sessionId: claims.sessionId,
      sessionVersion: claims.sessionVersion,
      tokenFamilyId: claims.tokenFamilyId,
    };

    let actor: AuthenticatedActor;
    switch (claims.actorType) {
      case AccessTokenActorType.User: {
        const userActor: AuthenticatedUserActor = { ...base, actorType: AccessTokenActorType.User };
        actor = userActor;
        break;
      }
      case AccessTokenActorType.Employee: {
        const employeeActor: AuthenticatedEmployeeActor = {
          ...base,
          actorType: AccessTokenActorType.Employee,
          employeeId: claims.employeeId,
          organizationId: claims.organizationId,
          restaurantId: claims.restaurantId,
          branchIds: claims.branchIds,
          permissions: claims.permissions,
          permissionsVersion: claims.permissionsVersion,
        };
        actor = employeeActor;
        break;
      }
      case AccessTokenActorType.OrganizationMember: {
        const orgMemberActor: AuthenticatedOrganizationMemberActor = {
          ...base,
          actorType: AccessTokenActorType.OrganizationMember,
          organizationId: claims.organizationId,
          orgRole: claims.orgRole,
          permissionsVersion: claims.permissionsVersion,
        };
        actor = orgMemberActor;
        break;
      }
      default:
        // PlatformAdmin never authenticates through this ordinary pipeline
        // (same exclusion as JwtAuthGuard - see authenticated-actor.dto.ts).
        throw new InvalidAccessTokenException();
    }

    const user = await this.userRepository.findById(UserId.create(actor.userId));
    if (user === null) {
      throw new InvalidAccessTokenException();
    }

    // `user.canLogin()` throws AccountSuspendedException/AccountLockedException/
    // EmailNotVerifiedException - propagated as-is, exactly like
    // SessionVersionGuard, so a suspended/locked account is rejected with a
    // distinguishable reason rather than collapsed into a generic invalid-token.
    user.canLogin();

    if (SessionPolicy.isSessionVersionStale(actor.sessionVersion, user.sessionVersion)) {
      throw new StaleSessionVersionException();
    }

    const expiresAt = typeof claims.exp === 'number' ? new Date(claims.exp * 1000) : null;
    return { actor, expiresAt };
  }

  /**
   * Mirrors `JwtAuthGuard.resolveAuthError`'s classification exactly, so a
   * genuinely expired handshake token surfaces as `ExpiredAccessTokenException`
   * rather than collapsing into the generic invalid case - same distinction
   * HTTP callers already get.
   */
  private verifyAccessToken(token: string): ReturnType<TokenService['verifyAccessToken']> {
    try {
      return this.tokenService.verifyAccessToken(token);
    } catch (error) {
      if (error instanceof UnauthorizedException) {
        const cause = (error as { cause?: unknown }).cause ?? error;
        if (cause instanceof TokenExpiredError) {
          throw new ExpiredAccessTokenException();
        }
        throw new InvalidAccessTokenException();
      }
      if (error instanceof TokenExpiredError) {
        throw new ExpiredAccessTokenException();
      }
      throw new InvalidAccessTokenException();
    }
  }
}
