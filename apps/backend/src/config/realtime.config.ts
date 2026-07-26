import { registerAs } from '@nestjs/config';

/**
 * Phase 8 (WebSocket, architecture frozen 2026-07-24). `maxRoomsPerSocket`'s
 * default of 32 is the one frozen numeric value in the freeze note (§17/§21
 * of the implementation authorization) - changing it requires stopping and
 * reporting, not a silent env override in any real deployment. The
 * handshake/subscribe/unsubscribe/unknown-event rate limits are NOT frozen
 * numbers (the freeze only requires reusing the existing
 * `RateLimiterPort`/Redis sliding-window infrastructure "where applicable");
 * these defaults follow the same conservative, env-overridable convention as
 * `RATE_LIMIT_LOGIN_MAX`/etc. in env.validation.ts.
 */
export default registerAs('realtime', () => ({
  maxRoomsPerSocket: parseInt(process.env.WS_MAX_ROOMS_PER_SOCKET ?? '32', 10),
  rateLimits: {
    handshake: {
      max: parseInt(process.env.WS_RATE_LIMIT_HANDSHAKE_MAX ?? '20', 10),
      windowSeconds: parseInt(process.env.WS_RATE_LIMIT_HANDSHAKE_WINDOW_SECONDS ?? '60', 10),
    },
    subscribe: {
      max: parseInt(process.env.WS_RATE_LIMIT_SUBSCRIBE_MAX ?? '60', 10),
      windowSeconds: parseInt(process.env.WS_RATE_LIMIT_SUBSCRIBE_WINDOW_SECONDS ?? '60', 10),
    },
    unsubscribe: {
      max: parseInt(process.env.WS_RATE_LIMIT_UNSUBSCRIBE_MAX ?? '60', 10),
      windowSeconds: parseInt(process.env.WS_RATE_LIMIT_UNSUBSCRIBE_WINDOW_SECONDS ?? '60', 10),
    },
    unknownEvent: {
      max: parseInt(process.env.WS_RATE_LIMIT_UNKNOWN_EVENT_MAX ?? '20', 10),
      windowSeconds: parseInt(process.env.WS_RATE_LIMIT_UNKNOWN_EVENT_WINDOW_SECONDS ?? '60', 10),
    },
  },
}));

export interface RealtimeRateLimitPolicy {
  max: number;
  windowSeconds: number;
}

export interface RealtimeConfig {
  maxRoomsPerSocket: number;
  rateLimits: {
    handshake: RealtimeRateLimitPolicy;
    subscribe: RealtimeRateLimitPolicy;
    unsubscribe: RealtimeRateLimitPolicy;
    unknownEvent: RealtimeRateLimitPolicy;
  };
}
