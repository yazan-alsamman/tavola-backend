import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as jwt from 'jsonwebtoken';
import { PlatformAdminAuthConfig } from '@config/platform-admin-auth.config';
import { PlatformAdminClaims } from '../../domain/services/platform-admin-claims';
import { PlatformAdminTokenService } from '../../domain/services/platform-admin-token.port';

/**
 * ADR-022 §"Platform Admin Authentication": signs/verifies exclusively with
 * `PLATFORM_ADMIN_JWT_SECRET`/`_ISSUER`/`_AUDIENCE` - completely independent
 * of `JwtTokenService`'s `JWT_ACCESS_SECRET`/`JWT_ISSUER`/`JWT_AUDIENCE`. A
 * token signed for the ordinary tenant/actor pipeline (even one that
 * somehow carried an `actorType: PlatformAdmin` claim) fails verification
 * here outright - `jwt.verify` rejects it on `issuer`/`audience` mismatch
 * before any claim is ever read, exactly the isolation this ADR requires.
 */
@Injectable()
export class JwtPlatformAdminTokenService implements PlatformAdminTokenService {
  private readonly config: PlatformAdminAuthConfig;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<PlatformAdminAuthConfig>('platformAdminAuth', {
      infer: true,
    });
    if (!config) {
      throw new Error('Platform Admin auth configuration is not loaded.');
    }
    if (config.jwtSecret.length < 32) {
      throw new Error('PLATFORM_ADMIN_JWT_SECRET must be at least 32 characters.');
    }
    this.config = config;
  }

  signAccessToken(claims: PlatformAdminClaims): string {
    return jwt.sign({ sub: claims.sub }, this.config.jwtSecret, {
      algorithm: 'HS256',
      expiresIn: this.config.jwtExpirySeconds,
      issuer: this.config.jwtIssuer,
      audience: this.config.jwtAudience,
    });
  }

  verifyAccessToken(token: string): PlatformAdminClaims {
    let payload: jwt.JwtPayload | string;
    try {
      payload = jwt.verify(token, this.config.jwtSecret, {
        algorithms: ['HS256'],
        issuer: this.config.jwtIssuer,
        audience: this.config.jwtAudience,
      });
    } catch (error) {
      throw new UnauthorizedException('Invalid Platform Admin access token.', { cause: error });
    }

    if (typeof payload === 'string' || !payload.sub) {
      throw new UnauthorizedException('Invalid Platform Admin access token payload.');
    }

    return { sub: payload.sub, iat: payload.iat, exp: payload.exp };
  }
}
