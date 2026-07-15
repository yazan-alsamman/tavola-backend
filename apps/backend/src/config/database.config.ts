import { registerAs } from '@nestjs/config';

export default registerAs('database', () => ({
  url: process.env.DATABASE_URL,
  poolMode: (process.env.DATABASE_POOL_MODE ?? 'transaction') as 'session' | 'transaction',
  maxConnections: parseInt(process.env.DATABASE_MAX_CONNECTIONS ?? '10', 10),
}));

export interface DatabaseConfig {
  url: string;
  poolMode: 'session' | 'transaction';
  maxConnections: number;
}
