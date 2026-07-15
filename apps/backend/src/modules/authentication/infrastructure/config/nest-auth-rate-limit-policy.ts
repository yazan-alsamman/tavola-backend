import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '@config/auth.config';
import {
  AuthRateLimitPolicyPort,
  RateLimitPolicyConfig,
  RateLimitPolicyName,
} from '../../application/ports/auth-rate-limit-policy.port';

@Injectable()
export class NestAuthRateLimitPolicy implements AuthRateLimitPolicyPort {
  private readonly policies: AuthConfig['rateLimits'];

  constructor(private readonly configService: ConfigService) {
    const auth = this.configService.get<AuthConfig>('auth', { infer: true });
    if (!auth) {
      throw new Error('Auth configuration is not loaded.');
    }
    this.policies = auth.rateLimits;
  }

  getPolicy(name: RateLimitPolicyName): RateLimitPolicyConfig {
    return this.policies[name];
  }
}
