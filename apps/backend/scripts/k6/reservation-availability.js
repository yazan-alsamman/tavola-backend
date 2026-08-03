// Phase 15 (Optimization, ADR-029) - Reservation Availability k6 scenario.
// Authenticated (JwtAuthGuard + SessionVersionGuard). Route verified against
// src/modules/reservations/presentation/controllers/reservations.controller.ts
// (GET /reservations/availability, SearchAvailabilityQueryDto).
//
// setup() logs in every seeded k6 Customer ONCE via the real
// POST /auth/customer/login endpoint (never bypassing JwtAuthGuard/
// SessionVersionGuard/rate limiting) and hands the resulting JWTs to every
// VU, so the load phase itself issues zero additional login calls and
// cannot be misread as rate-limiter interference (see D24/section 54 of the
// freeze report).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, AUTHENTICATED_API_THRESHOLDS, authHeaders } from './config.js';

const fixtures = JSON.parse(open('./k6-fixtures.json'));

export const options = {
  scenarios: {
    availability: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 10 },
        { duration: '30s', target: 10 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: AUTHENTICATED_API_THRESHOLDS,
};

// Login is rate-limited (auth.config.ts: RATE_LIMIT_LOGIN_MAX, default 10
// per 15 minutes per IP - docs/DECISIONS.md's Authentication rate-limit
// tiers). setup() must log in well under that ceiling regardless of how
// many VUs the scenario ramps to - tokens are reused across every VU/
// iteration, not re-fetched, so the load phase itself performs zero login
// calls. Never raise RATE_LIMIT_LOGIN_MAX to "fit" more logins (section 60
// of the freeze report).
const LOGIN_POOL_SIZE = Math.min(3, fixtures.customers.length);

export function setup() {
  const tokens = [];
  for (const customer of fixtures.customers.slice(0, LOGIN_POOL_SIZE)) {
    const res = http.post(
      `${BASE_URL}/auth/customer/login`,
      JSON.stringify({
        countryCode: customer.countryCode,
        phoneNumber: customer.phoneNumber,
        password: fixtures.password,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status !== 200) {
      throw new Error(`customer login failed in setup(): status=${res.status} body=${res.body}`);
    }
    tokens.push(JSON.parse(res.body).data.accessToken);
  }
  return { tokens };
}

export default function (data) {
  const token = data.tokens[__VU % data.tokens.length];
  const start = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  const res = http.get(
    `${BASE_URL}/reservations/availability?branchId=${fixtures.branchId}&reservationStartTime=${encodeURIComponent(start)}&partySize=2`,
    authHeaders(token),
  );
  check(res, {
    'availability: status is 200': (r) => r.status === 200,
    'availability: returns an array': (r) => {
      try {
        return Array.isArray(JSON.parse(r.body).data);
      } catch {
        return false;
      }
    },
  });

  sleep(1);
}
