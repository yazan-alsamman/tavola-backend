import { registerAs } from '@nestjs/config';

export default registerAs('app', () => {
  const nodeEnv = process.env.NODE_ENV ?? 'development';
  const swaggerExplicit = process.env.SWAGGER_ENABLED;

  return {
    nodeEnv,
    port: parseInt(process.env.PORT ?? '3000', 10),
    apiVersion: process.env.API_VERSION ?? 'v1',
    corsAllowedOrigins: (process.env.CORS_ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
    correlationIdHeader: process.env.CORRELATION_ID_HEADER ?? 'x-correlation-id',
    swaggerEnabled:
      swaggerExplicit === 'true' || (swaggerExplicit !== 'false' && nodeEnv !== 'production'),
    requestBodyLimit: process.env.REQUEST_BODY_LIMIT ?? '10mb',
  };
});

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'staging' | 'production';
  port: number;
  apiVersion: string;
  corsAllowedOrigins: string[];
  correlationIdHeader: string;
  swaggerEnabled: boolean;
  requestBodyLimit: string;
}
