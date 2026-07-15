import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { AuthConfig } from '@config/auth.config';
import { AccessTokenActorType, AccessTokenClaims } from '../../domain/services/access-token-claims';
import { TokenService } from '../../domain/services/token-service.port';

const CURRENT_KEY_ID = 'current';
const PREVIOUS_KEY_ID = 'previous';

@Injectable()
export class JwtTokenService implements TokenService {
  private readonly auth: AuthConfig;

  constructor(private readonly configService: ConfigService) {
    const auth = this.configService.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not loaded.');
    }
    if (auth.jwtAccessSecret.length < 32) {
      throw new Error('JWT_ACCESS_SECRET must be at least 32 characters.');
    }
    this.auth = auth;
  }

  signAccessToken(claims: AccessTokenClaims): string {
    return jwt.sign(claims, this.auth.jwtAccessSecret, {
      algorithm: 'HS256',
      expiresIn: this.auth.jwtAccessExpirySeconds,
      issuer: this.auth.jwtIssuer,
      audience: this.auth.jwtAudience,
      keyid: CURRENT_KEY_ID,
    });
  }

  verifyAccessToken(token: string): AccessTokenClaims {
    const decodedHeader = jwt.decode(token, { complete: true });
    const kid =
      decodedHeader && typeof decodedHeader === 'object' && decodedHeader.header
        ? (decodedHeader.header.kid as string | undefined)
        : undefined;

    const secrets: Array<{ secret: string; kid: string }> = [
      { secret: this.auth.jwtAccessSecret, kid: CURRENT_KEY_ID },
    ];

    if (this.auth.jwtAccessSecretPrevious.length >= 32) {
      secrets.push({
        secret: this.auth.jwtAccessSecretPrevious,
        kid: PREVIOUS_KEY_ID,
      });
    }

    const candidates = kid !== undefined ? secrets.filter((entry) => entry.kid === kid) : secrets;

    let lastError: Error | undefined;

    for (const candidate of candidates.length > 0 ? candidates : secrets) {
      try {
        const payload = jwt.verify(token, candidate.secret, {
          algorithms: ['HS256'],
          issuer: this.auth.jwtIssuer,
          audience: this.auth.jwtAudience,
        });

        return this.parseClaims(payload);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }

    // `cause` must be set here so JwtAuthGuard can distinguish a genuinely
    // expired token (ExpiredAccessTokenException) from every other failure
    // (InvalidAccessTokenException) - without it, `jwt.verify`'s own
    // `TokenExpiredError` was silently discarded and every real expired
    // token was misreported as a generic invalid one.
    throw new UnauthorizedException(lastError?.message ?? 'Invalid access token.', {
      cause: lastError,
    });
  }

  private parseClaims(payload: jwt.JwtPayload | string): AccessTokenClaims {
    if (typeof payload === 'string' || payload.sub === undefined) {
      throw new UnauthorizedException('Invalid access token payload.');
    }

    const actorType = payload.actorType as AccessTokenActorType | undefined;
    if (!actorType || !Object.values(AccessTokenActorType).includes(actorType)) {
      throw new UnauthorizedException('Invalid access token actor type.');
    }

    const base = {
      sub: payload.sub,
      actorType,
      sessionId: String(payload.sessionId ?? ''),
      sessionVersion: Number(payload.sessionVersion ?? 0),
      tokenFamilyId: String(payload.tokenFamilyId ?? ''),
      iat: payload.iat,
      exp: payload.exp,
    };

    if (!base.sessionId || !base.tokenFamilyId || base.sessionVersion < 1) {
      throw new UnauthorizedException('Invalid access token session claims.');
    }

    switch (actorType) {
      case AccessTokenActorType.User:
        return { ...base, actorType };

      case AccessTokenActorType.Employee:
        return {
          ...base,
          actorType,
          employeeId: String(payload.employeeId ?? ''),
          organizationId: String(payload.organizationId ?? ''),
          restaurantId: String(payload.restaurantId ?? ''),
          branchIds: Array.isArray(payload.branchIds) ? payload.branchIds.map(String) : [],
          permissions: Array.isArray(payload.permissions) ? payload.permissions.map(String) : [],
          permissionsVersion: Number(payload.permissionsVersion ?? 0),
        };

      case AccessTokenActorType.OrganizationMember:
        return {
          ...base,
          actorType,
          organizationId: String(payload.organizationId ?? ''),
          orgRole: String(payload.orgRole ?? ''),
          permissionsVersion: Number(payload.permissionsVersion ?? 0),
        };

      case AccessTokenActorType.PlatformAdmin:
        return { ...base, actorType };

      default:
        throw new UnauthorizedException('Unsupported access token actor type.');
    }
  }
}
