import { registerAs } from '@nestjs/config';

/**
 * ADR-022 Decision #5/#14/#17. `apiToken` is a server-side secret, read only
 * from environment configuration - never hardcoded, logged, or returned by
 * any API response (ENVIRONMENT_SETUP.md's "WhatsApp Verification" section
 * documents the variable NAME only, never its value).
 */
export default registerAs('fonnte', () => ({
  apiToken: process.env.FONNTE_API_TOKEN ?? '',
  apiUrl: process.env.FONNTE_API_URL ?? 'https://api.fonnte.com/send',
  requestTimeoutMs: parseInt(process.env.FONNTE_REQUEST_TIMEOUT_MS ?? '10000', 10),
}));

export interface FonnteConfig {
  apiToken: string;
  apiUrl: string;
  requestTimeoutMs: number;
}
