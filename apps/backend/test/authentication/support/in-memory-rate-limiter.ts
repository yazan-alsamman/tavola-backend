import {
  RateLimitDecision,
  RateLimiterPort,
} from '@modules/authentication/domain/services/rate-limiter.port';

/** Fixed-window counter per key, enough for unit tests of throttled code. */
export class InMemoryRateLimiter implements RateLimiterPort {
  private readonly counts = new Map<string, number>();

  async consume(
    key: string,
    limit: number,
    windowSeconds: number,
    now: Date,
  ): Promise<RateLimitDecision> {
    const used = (this.counts.get(key) ?? 0) + 1;
    this.counts.set(key, used);
    return {
      allowed: used <= limit,
      remaining: Math.max(0, limit - used),
      resetAt: new Date(now.getTime() + windowSeconds * 1000),
    };
  }
}
