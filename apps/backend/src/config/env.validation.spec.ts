import { envValidationSchema } from './env.validation';

describe('envValidationSchema', () => {
  const validBase = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/tavla_dev',
    REDIS_URL: 'redis://localhost:6379',
    MINIO_ENDPOINT: 'localhost',
    MINIO_ACCESS_KEY: 'access',
    MINIO_SECRET_KEY: 'secret',
    MINIO_PUBLIC_BUCKET: 'public',
    MINIO_PRIVATE_BUCKET: 'private',
    JWT_ACCESS_SECRET: 'dev-access-secret-at-least-32-characters-long',
    JWT_REFRESH_SECRET: 'dev-refresh-secret-at-least-32-characters-long',
  };

  it('accepts a minimal valid configuration', () => {
    const { error, value } = envValidationSchema.validate(validBase);

    expect(error).toBeUndefined();
    expect(value.NODE_ENV).toBe('development');
    expect(value.PORT).toBe(3000);
    expect(value.REQUEST_BODY_LIMIT).toBe('10mb');
  });

  it('defaults every rate-limit variable to the architecture-documented value', () => {
    const { error, value } = envValidationSchema.validate(validBase);

    expect(error).toBeUndefined();
    expect(value.RATE_LIMIT_LOGIN_MAX).toBe(10);
    expect(value.RATE_LIMIT_LOGIN_WINDOW_SECONDS).toBe(900);
    expect(value.RATE_LIMIT_REFRESH_MAX).toBe(30);
    expect(value.RATE_LIMIT_REFRESH_WINDOW_SECONDS).toBe(60);
    expect(value.RATE_LIMIT_FORGOT_PASSWORD_MAX).toBe(3);
    expect(value.RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS).toBe(3600);
    expect(value.RATE_LIMIT_RESET_PASSWORD_MAX).toBe(10);
    expect(value.RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS).toBe(900);
    expect(value.RATE_LIMIT_REGISTER_MAX).toBe(5);
    expect(value.RATE_LIMIT_REGISTER_WINDOW_SECONDS).toBe(3600);
    expect(value.RATE_LIMIT_CHANGE_PASSWORD_MAX).toBe(10);
    expect(value.RATE_LIMIT_CHANGE_PASSWORD_WINDOW_SECONDS).toBe(900);
  });

  it('rejects a non-positive rate-limit max', () => {
    const { error } = envValidationSchema.validate({
      ...validBase,
      RATE_LIMIT_LOGIN_MAX: 0,
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('RATE_LIMIT_LOGIN_MAX');
  });

  it('rejects a missing DATABASE_URL', () => {
    const { error } = envValidationSchema.validate({
      ...validBase,
      DATABASE_URL: undefined,
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('DATABASE_URL');
  });

  it('rejects an invalid NODE_ENV', () => {
    const { error } = envValidationSchema.validate({
      ...validBase,
      NODE_ENV: 'invalid',
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('NODE_ENV');
  });

  it('rejects an invalid DATABASE_POOL_MODE', () => {
    const { error } = envValidationSchema.validate({
      ...validBase,
      DATABASE_POOL_MODE: 'invalid',
    });

    expect(error).toBeDefined();
    expect(error?.message).toContain('DATABASE_POOL_MODE');
  });

  it('accepts an unset MINIO_PUBLIC_ENDPOINT (falls back to MINIO_ENDPOINT at the config layer)', () => {
    const { error } = envValidationSchema.validate(validBase);
    expect(error).toBeUndefined();
  });

  it('defaults MINIO_REGION to us-east-1 when unset', () => {
    const { error, value } = envValidationSchema.validate(validBase);
    expect(error).toBeUndefined();
    expect(value.MINIO_REGION).toBe('us-east-1');
  });

  it('accepts an explicit MINIO_PUBLIC_ENDPOINT/PORT/USE_SSL override', () => {
    const { error, value } = envValidationSchema.validate({
      ...validBase,
      MINIO_PUBLIC_ENDPOINT: 'cdn.example.com',
      MINIO_PUBLIC_PORT: 443,
      MINIO_PUBLIC_USE_SSL: true,
    });

    expect(error).toBeUndefined();
    expect(value.MINIO_PUBLIC_ENDPOINT).toBe('cdn.example.com');
    expect(value.MINIO_PUBLIC_PORT).toBe(443);
    expect(value.MINIO_PUBLIC_USE_SSL).toBe(true);
  });
});
