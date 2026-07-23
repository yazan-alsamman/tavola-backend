import { registerAs } from '@nestjs/config';

/**
 * ADR-024 (supersedes ADR-022's Fonnte Integration Boundary). `apiKey` is a
 * server-side secret, read only from environment configuration - never
 * hardcoded, logged, or returned by any API response (ENVIRONMENT_SETUP.md's
 * "WhatsApp Verification" section documents the variable NAME only, never
 * its value).
 */
export default registerAs('lightotp', () => ({
  apiKey: process.env.LIGHTOTP_API_KEY ?? '',
  apiUrl: process.env.LIGHTOTP_API_URL ?? 'https://api.lightotp.com/SendMessage',
  requestTimeoutMs: parseInt(process.env.LIGHTOTP_REQUEST_TIMEOUT_MS ?? '10000', 10),
}));

export interface LightOtpConfig {
  apiKey: string;
  apiUrl: string;
  requestTimeoutMs: number;
}
