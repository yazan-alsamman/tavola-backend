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
    // Phase 19.8 (Owner Invite) - the base URL used to build the invitation
    // acceptance link sent by email. The backend never renders a web page
    // itself, so this must point at the frontend/web client route that calls
    // `POST /invitations/:token/accept`.
    webBaseUrl: process.env.APP_WEB_BASE_URL ?? 'http://localhost:3000',
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
  webBaseUrl: string;
}
