// Phase 15 (Optimization, ADR-029) - Reservation Creation k6 scenario.
// Authenticated (JwtAuthGuard + SessionVersionGuard), mutating. Route
// verified against
// src/modules/reservations/presentation/controllers/reservations.controller.ts
// (POST /reservations, CreateReservationRequestDto). Never disables
// ADR-013's advisory lock / exclusion constraint, JwtAuthGuard,
// SessionVersionGuard, or rate limiting to "improve" numbers (section 60 of
// the freeze report).
//
// Each VU is pinned to one seeded Table and picks a unique future time slot
// per iteration (VU index + iteration counter), so most requests do NOT
// compete for the same table/window - this measures Create's real latency
// under concurrent, mostly-independent writes, not an artificial single-row
// contention scenario (that would be a deliberate, separately-scoped
// conflict test, not this one - see section 41 of the freeze report).
import http from 'k6/http';
import { check, sleep } from 'k6';
import { BASE_URL, AUTHENTICATED_API_THRESHOLDS, authHeaders } from './config.js';

const fixtures = JSON.parse(open('./k6-fixtures.json'));

export const options = {
  scenarios: {
    creation: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '10s', target: 5 },
        { duration: '20s', target: 5 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: AUTHENTICATED_API_THRESHOLDS,
};

// See reservation-availability.js's own comment: login is rate-limited
// (default 10/15min per IP), so setup() logs in a small, fixed pool reused
// across every VU/iteration rather than one login per VU.
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
  const tableId = fixtures.tableIds[__VU % fixtures.tableIds.length];

  // Base offset spreads VUs across different days; iteration counter spreads
  // a single VU's own repeated requests across different hours within that
  // day, keeping same-table/same-window collisions rare by construction.
  const dayOffset = 2 + (__VU % 30);
  const hourOffset = 8 + (__ITER % 10);
  const start = new Date();
  start.setUTCDate(start.getUTCDate() + dayOffset);
  start.setUTCHours(hourOffset, 0, 0, 0);

  const res = http.post(
    `${BASE_URL}/reservations`,
    JSON.stringify({
      branchId: fixtures.branchId,
      tableId,
      reservationStartTime: start.toISOString(),
      guests: 2,
      source: 'Online',
    }),
    authHeaders(token),
  );

  check(res, {
    // 201 = created; 409 = a genuine, correctly-detected conflict (ADR-013
    // doing its job, not a failure) - both are "the system behaved
    // correctly" outcomes for this check. Anything else is a real problem.
    'create: status is 201 or a genuine 409 conflict': (r) => r.status === 201 || r.status === 409,
  });

  sleep(1);
}
