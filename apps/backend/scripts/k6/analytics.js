// Phase 15 (Optimization, ADR-029) - Analytics k6 scenario.
// Authenticated (Organization Owner/Admin, or Employee with reports:view -
// ADR-028 decision #5). Route verified against
// src/modules/analytics/presentation/controllers/analytics.controller.ts
// (GET /restaurants/:restaurantId/analytics/reservations/summary,
// AnalyticsDateRangeQueryDto). Measures the current ADR-028 architecture
// (direct PostgreSQL reads, no cache/materialized view/queue) as implemented
// - this scenario does not add any of those to "improve" the number.
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, ANALYTICS_THRESHOLDS, authHeaders } from './config.js';

const fixtures = JSON.parse(open('./k6-fixtures.json'));

export const options = {
  scenarios: {
    analytics: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: ANALYTICS_THRESHOLDS,
};

export function setup() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: fixtures.owner.email, password: fixtures.password }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  if (res.status !== 200) {
    throw new Error(`owner login failed in setup(): status=${res.status} body=${res.body}`);
  }
  return { token: JSON.parse(res.body).data.accessToken };
}

export default function (data) {
  const res = http.get(
    `${BASE_URL}/restaurants/${fixtures.restaurantId}/analytics/reservations/summary?range=last30d`,
    authHeaders(data.token),
  );
  check(res, {
    'analytics summary: status is 200': (r) => r.status === 200,
    'analytics summary: has data payload': (r) => {
      try {
        return JSON.parse(r.body).data !== undefined;
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
