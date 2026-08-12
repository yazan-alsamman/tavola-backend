import { registerAs } from '@nestjs/config';

/**
 * Phase 19.8 (Owner Invite, ADR-036 - Email Provider Abstraction). Generic
 * SMTP - vendor-neutral by design, works behind any SMTP-speaking service
 * (Amazon SES, Gmail, a SendGrid/Mailgun SMTP relay, self-hosted Postfix, or
 * Mailhog/Ethereal for dev/test). `SMTP_USER`/`SMTP_PASSWORD` are server-side
 * secrets, read only from environment configuration - never hardcoded,
 * logged, or returned by any API response, mirroring `onesignal.config.ts`/
 * `lightotp.config.ts`'s precedent exactly. Nothing here is `.required()` so
 * the application still boots in environments without real SMTP credentials
 * configured (tests, local dev) - `SmtpEmailProvider` itself fails closed
 * (never silently "succeeds") when unconfigured.
 */
export default registerAs('smtp', () => ({
  host: process.env.SMTP_HOST ?? '',
  port: parseInt(process.env.SMTP_PORT ?? '587', 10),
  secure: (process.env.SMTP_SECURE ?? 'false') === 'true',
  user: process.env.SMTP_USER ?? '',
  password: process.env.SMTP_PASSWORD ?? '',
  fromAddress: process.env.SMTP_FROM_ADDRESS ?? '',
  fromName: process.env.SMTP_FROM_NAME ?? 'Tavla',
  requestTimeoutMs: parseInt(process.env.SMTP_REQUEST_TIMEOUT_MS ?? '10000', 10),
}));

export interface SmtpConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password: string;
  fromAddress: string;
  fromName: string;
  requestTimeoutMs: number;
}
