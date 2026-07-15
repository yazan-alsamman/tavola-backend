import { randomUUID } from 'crypto';

const MAX_CORRELATION_ID_LENGTH = 128;
const SAFE_CORRELATION_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

/**
 * Accepts a client-supplied correlation ID when it is safe; otherwise
 * generates a new one so log injection / oversized header values cannot
 * propagate through structured logs.
 */
export function resolveCorrelationId(existing: string | string[] | undefined): string {
  const candidate = Array.isArray(existing) ? existing[0] : existing;

  if (typeof candidate !== 'string') {
    return randomUUID();
  }

  const trimmed = candidate.trim().slice(0, MAX_CORRELATION_ID_LENGTH);

  if (trimmed.length === 0 || !SAFE_CORRELATION_ID_PATTERN.test(trimmed)) {
    return randomUUID();
  }

  return trimmed;
}
