import { ConfigService } from '@nestjs/config';
import { AuthConfig } from '@config/auth.config';
import { NestAuthRateLimitPolicy } from './nest-auth-rate-limit-policy';

function buildConfigService(overrides?: Partial<AuthConfig['rateLimits']>): ConfigService {
  const auth: Pick<AuthConfig, 'rateLimits'> = {
    rateLimits: {
      login: { max: 10, windowSeconds: 900 },
      refresh: { max: 30, windowSeconds: 60 },
      forgotPassword: { max: 3, windowSeconds: 3600 },
      resetPassword: { max: 10, windowSeconds: 900 },
      register: { max: 5, windowSeconds: 3600 },
      changePassword: { max: 10, windowSeconds: 900 },
      customerRegisterSend: { max: 5, windowSeconds: 3600 },
      customerRegisterVerify: { max: 10, windowSeconds: 900 },
      customerPasswordResetSend: { max: 5, windowSeconds: 3600 },
      customerPasswordResetVerify: { max: 10, windowSeconds: 900 },
      customerRegisterComplete: { max: 5, windowSeconds: 3600 },
      customerPasswordResetComplete: { max: 5, windowSeconds: 3600 },
      ...overrides,
    },
  };
  return { get: () => auth } as unknown as ConfigService;
}

describe('NestAuthRateLimitPolicy', () => {
  it('returns the configured policy for each named policy', () => {
    const adapter = new NestAuthRateLimitPolicy(buildConfigService());

    expect(adapter.getPolicy('login')).toEqual({ max: 10, windowSeconds: 900 });
    expect(adapter.getPolicy('refresh')).toEqual({ max: 30, windowSeconds: 60 });
    expect(adapter.getPolicy('forgotPassword')).toEqual({ max: 3, windowSeconds: 3600 });
    expect(adapter.getPolicy('resetPassword')).toEqual({ max: 10, windowSeconds: 900 });
    expect(adapter.getPolicy('register')).toEqual({ max: 5, windowSeconds: 3600 });
    expect(adapter.getPolicy('changePassword')).toEqual({ max: 10, windowSeconds: 900 });
    expect(adapter.getPolicy('customerRegisterComplete')).toEqual({
      max: 5,
      windowSeconds: 3600,
    });
    expect(adapter.getPolicy('customerPasswordResetComplete')).toEqual({
      max: 5,
      windowSeconds: 3600,
    });
  });

  it('throws at construction time when auth configuration is not loaded', () => {
    const configService = { get: () => undefined } as unknown as ConfigService;
    expect(() => new NestAuthRateLimitPolicy(configService)).toThrow(
      'Auth configuration is not loaded.',
    );
  });
});
