import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '@config/auth.config';
import { AuthTokenTtlPort } from '../../application/ports/auth-token-ttl.port';

@Injectable()
export class NestAuthTokenTtl implements AuthTokenTtlPort {
  readonly accessTokenTtlSeconds: number;

  constructor(private readonly configService: ConfigService) {
    const auth = this.configService.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not loaded.');
    }
    this.accessTokenTtlSeconds = auth.jwtAccessExpirySeconds;
  }
}
