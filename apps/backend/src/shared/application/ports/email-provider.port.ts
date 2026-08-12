/**
 * Phase 19.8 (Owner Invite, ADR-036 - Email Provider Abstraction). The
 * provider-independent contract application/domain code depends on -
 * mirrors `NotificationProviderPort`'s existing Anti-Corruption Layer shape
 * (ADR-007) exactly. No SMTP-specific (or any other vendor's) types, headers,
 * or transport details may leak through this interface - those belong
 * entirely to the infrastructure adapter (`SmtpEmailProvider`) behind it.
 * Replacing the concrete adapter (e.g. with a transactional-email API
 * adapter) never requires a change to any caller of this port.
 */
export interface EmailSendParams {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export type EmailSendResult =
  | { readonly outcome: 'sent' }
  | { readonly outcome: 'retryableFailure'; readonly reason: string }
  | { readonly outcome: 'permanentFailure'; readonly reason: string };

export interface EmailProviderPort {
  send(params: EmailSendParams): Promise<EmailSendResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
