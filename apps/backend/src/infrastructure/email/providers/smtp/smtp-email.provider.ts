import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as nodemailer from 'nodemailer';
import { SmtpConfig } from '@config/smtp.config';
import {
  EmailProviderPort,
  EmailSendParams,
  EmailSendResult,
} from '@shared/application/ports/email-provider.port';

/**
 * Phase 19.8 (Owner Invite, ADR-036) - the ONLY place in the codebase
 * permitted to speak SMTP directly (mirrors `OneSignalNotificationProvider`'s
 * own "sole adapter" convention for its transport). Generic SMTP via
 * `nodemailer` - vendor-neutral, works behind any SMTP-speaking service
 * (Amazon SES, Gmail, a SendGrid/Mailgun SMTP relay, self-hosted Postfix, or
 * Mailhog/Ethereal for dev/test), configured entirely via `smtp.config.ts`.
 *
 * Never logs the SMTP password, and never logs full message content (mirrors
 * `OneSignalNotificationProvider`/`LightOtpVerificationMessagingAdapter`'s
 * precedent) - only coarse, non-sensitive failure classification.
 */
@Injectable()
export class SmtpEmailProvider implements EmailProviderPort {
  private readonly logger = new Logger(SmtpEmailProvider.name);
  private readonly config: SmtpConfig;

  constructor(private readonly configService: ConfigService) {
    const config = this.configService.get<SmtpConfig>('smtp', { infer: true });
    if (!config) {
      throw new Error('SMTP configuration is not loaded.');
    }
    this.config = config;
  }

  async send(params: EmailSendParams): Promise<EmailSendResult> {
    if (!this.config.host || !this.config.fromAddress) {
      // Fails closed rather than silently "succeeding" with no real
      // delivery - never logs the password itself, only that it is absent.
      this.logger.error('SMTP_HOST/SMTP_FROM_ADDRESS are not configured; cannot send email.');
      return { outcome: 'permanentFailure', reason: 'not_configured' };
    }

    const transport = nodemailer.createTransport({
      host: this.config.host,
      port: this.config.port,
      secure: this.config.secure,
      auth: this.config.user ? { user: this.config.user, pass: this.config.password } : undefined,
      connectionTimeout: this.config.requestTimeoutMs,
      socketTimeout: this.config.requestTimeoutMs,
    });

    try {
      await transport.sendMail({
        from: `${this.config.fromName} <${this.config.fromAddress}>`,
        to: params.to,
        subject: params.subject,
        text: params.text,
        html: params.html,
      });
      return { outcome: 'sent' };
    } catch (error) {
      const reason = this.classifyFailure(error);
      this.logger.error(`SMTP send failed: ${reason}`);
      return reason === 'invalid_recipient'
        ? { outcome: 'permanentFailure', reason }
        : { outcome: 'retryableFailure', reason };
    }
  }

  private classifyFailure(error: unknown): string {
    const code = (error as { responseCode?: number; code?: string } | null)?.responseCode;
    if (typeof code === 'number' && code >= 500 && code < 600) {
      return 'invalid_recipient';
    }
    const errCode = (error as { code?: string } | null)?.code;
    if (errCode === 'ETIMEDOUT' || errCode === 'ESOCKET') {
      return 'timeout';
    }
    return errCode ?? 'unknown_error';
  }
}
