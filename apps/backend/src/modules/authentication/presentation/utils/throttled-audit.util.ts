import type {
  AuditLogEntry,
  AuditLogWriterPort,
} from '@shared/application/ports/audit-log-writer.port';
import type { RateLimiterPort } from '../../domain/services/rate-limiter.port';

/** One audit row per action per source address per window. */
const AUDIT_THROTTLE_WINDOW_SECONDS = 60;

/**
 * Records a security audit entry that unauthenticated callers can trigger at
 * will (a bad or expired token, a rate-limit rejection). Without a throttle
 * every such request was a database write, so a loop of junk requests could
 * grow the audit table without bound. The first occurrence per action and
 * address in each minute is still recorded, which keeps the signal.
 */
export async function recordThrottledAudit(
  auditLogWriter: AuditLogWriterPort,
  rateLimiter: RateLimiterPort,
  entry: AuditLogEntry,
): Promise<void> {
  const key = `audit:throttle:${entry.action}:${entry.ipAddress ?? 'unknown'}`;
  const decision = await rateLimiter.consume(
    key,
    1,
    AUDIT_THROTTLE_WINDOW_SECONDS,
    entry.occurredAt,
  );
  if (decision.allowed) {
    await auditLogWriter.record(entry);
  }
}
