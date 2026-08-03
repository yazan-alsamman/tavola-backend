import { registerAs } from '@nestjs/config';

/**
 * Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, D12): one
 * coherent public rate-limit tier for every `/discovery/**` route, mirroring
 * `auth.config.ts`'s env-overridable-with-frozen-default convention. Default
 * (60 requests / 60 seconds / client IP) is the frozen v1 number recorded in
 * `TASKS.md`'s Phase 15.5 decision note (D12) and `API_GUIDELINES.md`'s Rate
 * Limiting section - deliberately not reusing `auth.rateLimits`' numbers,
 * which target a different threat model (credential-guessing abuse, not
 * high-frequency public read traffic).
 */
export default registerAs('discovery', () => ({
  rateLimit: {
    max: parseInt(process.env.RATE_LIMIT_DISCOVERY_MAX ?? '60', 10),
    windowSeconds: parseInt(process.env.RATE_LIMIT_DISCOVERY_WINDOW_SECONDS ?? '60', 10),
  },
}));

export interface DiscoveryConfig {
  rateLimit: {
    max: number;
    windowSeconds: number;
  };
}
