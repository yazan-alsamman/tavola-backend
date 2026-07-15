import { registerAs } from '@nestjs/config';

export default registerAs('logging', () => ({
  level: process.env.LOG_LEVEL ?? 'info',
  // Deliberately NOT derived from NODE_ENV: this container always runs the
  // production-built image (Docker Compose has no separate dev Dockerfile),
  // and pino-pretty is a devDependency pruned from that image - enabling it
  // via NODE_ENV=development would crash at boot with a missing transport
  // module. Only a bare-metal `pnpm start:dev` (outside Docker, with
  // devDependencies installed) should ever set this to true, as a local,
  // personal preference - never committed as true in any shared env file.
  pretty: process.env.LOG_PRETTY === 'true',
}));

export interface LoggingConfig {
  level: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';
  pretty: boolean;
}
