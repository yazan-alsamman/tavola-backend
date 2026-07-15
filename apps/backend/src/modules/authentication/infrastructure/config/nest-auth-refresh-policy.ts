import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '@config/auth.config';
import { AuthRefreshPolicyPort } from '../../application/ports/auth-refresh-policy.port';

@Injectable()
export class NestAuthRefreshPolicy implements AuthRefreshPolicyPort {
  readonly refreshConcurrentGraceMs: number;

  constructor(private readonly configService: ConfigService) {
    const auth = this.configService.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not loaded.');
    }
    this.refreshConcurrentGraceMs = auth.refreshConcurrentGraceMs;
  }
}
