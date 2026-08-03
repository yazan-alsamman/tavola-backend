process.env.NODE_ENV ??= 'development';
process.env.PORT ??= '3000';
process.env.API_VERSION ??= 'v1';
process.env.CORS_ALLOWED_ORIGINS ??= 'http://localhost:3000';
process.env.DATABASE_URL ??=
  'postgresql://tavla:tavla_dev_password@localhost:5433/tavla_dev?schema=public&connection_limit=5';
process.env.DATABASE_POOL_MODE ??= 'transaction';
process.env.DATABASE_MAX_CONNECTIONS ??= '5';
process.env.REDIS_URL ??= 'redis://:tavla_dev_redis_password@localhost:6379';
process.env.REDIS_CACHE_DB_INDEX ??= '0';
process.env.REDIS_QUEUE_DB_INDEX ??= '1';
process.env.REDIS_SOCKET_ADAPTER_DB_INDEX ??= '2';
process.env.MINIO_ENDPOINT ??= 'localhost';
process.env.MINIO_PORT ??= '9000';
process.env.MINIO_USE_SSL ??= 'false';
process.env.MINIO_ACCESS_KEY ??= 'tavla_minio_access';
process.env.MINIO_SECRET_KEY ??= 'tavla_minio_secret';
process.env.MINIO_PUBLIC_BUCKET ??= 'tavla-public';
process.env.MINIO_PRIVATE_BUCKET ??= 'tavla-private';
process.env.MINIO_SIGNED_URL_EXPIRY_SECONDS ??= '3600';
process.env.LOG_LEVEL ??= 'error';
process.env.LOG_PRETTY ??= 'false';
process.env.CORRELATION_ID_HEADER ??= 'x-correlation-id';
process.env.JWT_ACCESS_SECRET ??= 'test-access-secret-at-least-32-characters-long';
process.env.JWT_REFRESH_SECRET ??= 'test-refresh-secret-at-least-32-characters-long';
process.env.ARGON2_MEMORY_COST ??= '4096';
process.env.ARGON2_TIME_COST ??= '1';
// Generous by default so the many legitimate login/refresh/forgot-password
// calls across the full e2e suite (all sharing one loopback IP with no
// X-Forwarded-For header) never trip the production-accurate limits.
// rate-limit.e2e-spec.ts overrides these to small values for its own
// isolated app instance and restores them afterward.
// Raised from 1000 (2026-07-29, Phase 15.5 verification session): the suite
// has grown to 465 tests across 41 e2e files, each commonly logging in
// multiple times in setup; 1000 shared logins per 900s window across the
// whole loopback-IP-keyed counter started tripping mid-run. Login's own
// window is 900s (auth.config.ts) - this only needs to clear real full-suite
// wall-clock volume within that window, not change any production default.
process.env.RATE_LIMIT_LOGIN_MAX ??= '10000';
process.env.RATE_LIMIT_REFRESH_MAX ??= '10000';
process.env.RATE_LIMIT_FORGOT_PASSWORD_MAX ??= '10000';
process.env.RATE_LIMIT_RESET_PASSWORD_MAX ??= '10000';
process.env.RATE_LIMIT_REGISTER_MAX ??= '10000';
process.env.RATE_LIMIT_CHANGE_PASSWORD_MAX ??= '10000';
