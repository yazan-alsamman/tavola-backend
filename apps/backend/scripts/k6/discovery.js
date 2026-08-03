// Phase 15 (Optimization, ADR-029) - Discovery k6 scenario.
// Public, unauthenticated endpoints. Route paths verified against
// src/modules/discovery/presentation/controllers/discovery.controller.ts
// (not guessed): GET /discovery/restaurants, GET /discovery/restaurants/nearby.
//
// Discovery has its own dedicated rate limit (D12 of the Phase 15.5 freeze:
// 60 requests / 60 seconds, per client IP - discovery-rate-limit.guard.ts).
// Every k6 VU in this containerized run shares one source IP, so this
// scenario deliberately paces itself under that ceiling (1 request per
// iteration, single VU, ~2s between requests) rather than bursting past it -
// exceeding it would test the rate limiter, not backend performance, and a
// resulting 429 would not be a "backend performance failure" (section 54 of
// the freeze report). This also matches production reality: one real client
// IP is itself bound by the same 60/60s ceiling.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, PUBLIC_API_THRESHOLDS } from './config.js';

export const options = {
  scenarios: {
    discovery: {
      executor: 'constant-vus',
      vus: 1,
      duration: '50s',
    },
  },
  thresholds: PUBLIC_API_THRESHOLDS,
};

const ENDPOINTS = [
  () => http.get(`${BASE_URL}/discovery/restaurants?page=1&limit=20`),
  () =>
    http.get(
      `${BASE_URL}/discovery/restaurants?q=Restaurant&priceLevel=2&sort=rating&page=1&limit=20`,
    ),
  () => http.get(`${BASE_URL}/discovery/restaurants/nearby?lat=41.0&lng=29.0&radiusKm=10&page=1&limit=20`),
];

export default function () {
  const endpoint = ENDPOINTS[__ITER % ENDPOINTS.length];
  const res = endpoint();
  check(res, {
    'status is 200': (r) => r.status === 200,
    'has data payload': (r) => {
      try {
        return JSON.parse(r.body).data !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(2);
}
