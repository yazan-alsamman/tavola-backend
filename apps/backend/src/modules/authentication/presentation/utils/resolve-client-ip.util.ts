import type { Request } from 'express';

/**
 * Single shared IP-resolution rule for everything that needs a client
 * address (LoginUseCase's audit trail via `AuthController`, and
 * `RateLimitGuard`'s per-IP buckets) - one rule, never duplicated.
 * `X-Forwarded-For`'s first hop is trusted only because Nginx (the only
 * entry point per ARCHITECTURE.md) sets it itself; a direct-to-app request
 * bypassing Nginx falls back to the socket address.
 */
export function resolveClientIp(request: Request): string {
  const forwarded = request.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }
  return request.ip || request.socket.remoteAddress || 'unknown';
}
