import * as Joi from 'joi';

/**
 * Scoped to the environment variables Foundation-phase infrastructure
 * actually consumes. Each future phase (Authentication, Notifications, ...)
 * extends this schema when it introduces the module that reads the
 * corresponding variables - see ENVIRONMENT_SETUP.md.
 */
export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'test', 'staging', 'production')
    .default('development'),
  PORT: Joi.number().port().default(3000),
  API_VERSION: Joi.string().default('v1'),
  CORS_ALLOWED_ORIGINS: Joi.string().default(''),

  DATABASE_URL: Joi.string().uri().required(),
  DATABASE_POOL_MODE: Joi.string().valid('session', 'transaction').default('transaction'),
  DATABASE_MAX_CONNECTIONS: Joi.number().integer().min(1).default(10),

  REDIS_URL: Joi.string().uri().required(),
  REDIS_CACHE_DB_INDEX: Joi.number().integer().min(0).default(0),
  REDIS_QUEUE_DB_INDEX: Joi.number().integer().min(0).default(1),
  REDIS_SOCKET_ADAPTER_DB_INDEX: Joi.number().integer().min(0).default(2),

  MINIO_ENDPOINT: Joi.string().required(),
  MINIO_PORT: Joi.number().port().default(9000),
  MINIO_USE_SSL: Joi.boolean().default(false),
  // Set explicitly so the SDK never needs to auto-detect a bucket's region
  // over the network (a real HTTP round-trip on every presignedGetObject
  // call otherwise) - required for presigning to work at all when the
  // signing client's endpoint isn't itself network-reachable (see
  // MINIO_PUBLIC_ENDPOINT: it may point at a browser-facing host the
  // backend container cannot dial directly).
  MINIO_REGION: Joi.string().default('us-east-1'),
  MINIO_ACCESS_KEY: Joi.string().required(),
  MINIO_SECRET_KEY: Joi.string().required(),
  MINIO_PUBLIC_BUCKET: Joi.string().required(),
  MINIO_PRIVATE_BUCKET: Joi.string().required(),
  MINIO_SIGNED_URL_EXPIRY_SECONDS: Joi.number().integer().min(1).default(3600),
  // Client-reachable endpoint used only for presigned URL generation.
  // Defaults to MINIO_ENDPOINT/PORT/USE_SSL, which is correct when the
  // backend and external clients share the same network path (bare-metal
  // dev, .env.example). It must be overridden whenever the backend reaches
  // MinIO over an internal-only hostname (e.g. Docker Compose's `minio`
  // service name) that a browser/mobile client could never resolve - a
  // presigned URL signs the Host header, so the endpoint used for signing
  // must already be the one the client will actually call.
  MINIO_PUBLIC_ENDPOINT: Joi.string().optional(),
  MINIO_PUBLIC_PORT: Joi.number().port().optional(),
  MINIO_PUBLIC_USE_SSL: Joi.boolean().optional(),

  LOG_LEVEL: Joi.string().valid('fatal', 'error', 'warn', 'info', 'debug', 'trace').default('info'),
  LOG_PRETTY: Joi.boolean().default(false),
  CORRELATION_ID_HEADER: Joi.string().default('x-correlation-id'),
  SWAGGER_ENABLED: Joi.boolean().optional(),
  REQUEST_BODY_LIMIT: Joi.string().default('10mb'),

  JWT_ACCESS_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_SECRET_PREVIOUS: Joi.string().min(32).allow('').default(''),
  JWT_REFRESH_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_EXPIRY: Joi.string().default('15m'),
  JWT_REFRESH_EXPIRY: Joi.string().default('30d'),
  JWT_ISSUER: Joi.string().default('tavla-api'),
  JWT_AUDIENCE: Joi.string().default('tavla-clients'),

  ARGON2_MEMORY_COST: Joi.number().integer().min(4096).default(65536),
  ARGON2_TIME_COST: Joi.number().integer().min(1).max(10).default(3),
  ARGON2_PARALLELISM: Joi.number().integer().min(1).max(8).default(1),

  REFRESH_CONCURRENT_GRACE_MS: Joi.number().integer().min(0).max(300_000).default(30_000),

  RATE_LIMIT_LOGIN_MAX: Joi.number().integer().min(1).default(10),
  RATE_LIMIT_LOGIN_WINDOW_SECONDS: Joi.number().integer().min(1).default(900),
  RATE_LIMIT_REFRESH_MAX: Joi.number().integer().min(1).default(30),
  RATE_LIMIT_REFRESH_WINDOW_SECONDS: Joi.number().integer().min(1).default(60),
  RATE_LIMIT_FORGOT_PASSWORD_MAX: Joi.number().integer().min(1).default(3),
  RATE_LIMIT_FORGOT_PASSWORD_WINDOW_SECONDS: Joi.number().integer().min(1).default(3600),
  RATE_LIMIT_RESET_PASSWORD_MAX: Joi.number().integer().min(1).default(10),
  RATE_LIMIT_RESET_PASSWORD_WINDOW_SECONDS: Joi.number().integer().min(1).default(900),
  RATE_LIMIT_REGISTER_MAX: Joi.number().integer().min(1).default(5),
  RATE_LIMIT_REGISTER_WINDOW_SECONDS: Joi.number().integer().min(1).default(3600),
  RATE_LIMIT_CHANGE_PASSWORD_MAX: Joi.number().integer().min(1).default(10),
  RATE_LIMIT_CHANGE_PASSWORD_WINDOW_SECONDS: Joi.number().integer().min(1).default(900),
});
