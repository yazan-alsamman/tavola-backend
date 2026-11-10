import type { Request } from 'express';

/**
 * Number of reverse proxies in front of the app that append to
 * `X-Forwarded-For` (production: one Nginx). Validated in env.validation.ts.
 */
const DEFAULT_TRUSTED_PROXY_HOPS = 1;

function trustedProxyHops(): number {
  const parsed = Number.parseInt(process.env.TRUSTED_PROXY_HOPS ?? '', 10);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : DEFAULT_TRUSTED_PROXY_HOPS;
}

/**
 * The client address as seen by the outermost trusted proxy.
 *
 * `X-Forwarded-For` is a chain: whatever the client sent comes first, and
 * each proxy appends the address it received the request from. Only the
 * entries our own proxies appended can be trusted, so the client is the
 * entry `trustedHops` steps from the right of `[...forwarded, socket]` -
 * never the first entry, which a caller can set to anything (that let a
 * caller rotate a fake address per request and slip past every per-IP rate
 * limit). Falls back to the socket address when the chain is shorter than
 * the trusted hops (a direct request that bypassed the proxy).
 */
export function clientIpFromForwardedChain(
  forwardedFor: string | string[] | undefined,
  socketAddress: string | undefined,
  trustedHops: number = trustedProxyHops(),
): string {
  const header = Array.isArray(forwardedFor) ? forwardedFor.join(',') : (forwardedFor ?? '');
  const chain = header
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
  const socket = socketAddress?.trim();
  const addresses = socket ? [...chain, socket] : chain;

  const index = addresses.length - 1 - trustedHops;
  const resolved = index >= 0 ? addresses[index] : socket;
  return resolved || 'unknown';
}

/**
 * Single shared IP-resolution rule for everything that needs a client
 * address over HTTP (audit trail, `RateLimitGuard`'s per-IP buckets).
 */
export function resolveClientIp(request: Request): string {
  return clientIpFromForwardedChain(
    request.headers['x-forwarded-for'],
    request.ip || request.socket?.remoteAddress,
  );
}
