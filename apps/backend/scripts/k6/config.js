// Phase 15 (Optimization, ADR-029) - shared k6 configuration.
//
// Thresholds are sourced ONLY from docs/NON_FUNCTIONAL_REQUIREMENTS.md:
//   - Public API:         avg <= 200ms, p95 <= 500ms, p99 <= 1000ms
//   - Authenticated API:  avg <= 250ms, p95 <= 600ms
//   - Heavy operations (Analytics/Reports/Exports): max execution <= 30s
//   - "Reservation lookup < 100ms" is reported separately as an additional
//     reference line (TESTING_STRATEGY.md's own load-test scope note) but is
//     NOT used as the pass/fail gate for availability/creation below, since
//     it most literally describes a single-reservation GET by id, which this
//     suite does not exercise - reported as NO FROZEN TARGET for that exact
//     shape, not fabricated.
//
// No secrets, no developer-specific hosts, no hardcoded credentials -
// everything below is environment-driven (`-e KEY=value` on `k6 run`).

export const BASE_URL = __ENV.BASE_URL || 'http://localhost/api/v1';

export const PUBLIC_API_THRESHOLDS = {
  http_req_duration: ['avg<200', 'p(95)<500', 'p(99)<1000'],
  http_req_failed: ['rate<0.01'],
};

export const AUTHENTICATED_API_THRESHOLDS = {
  http_req_duration: ['avg<250', 'p(95)<600'],
  http_req_failed: ['rate<0.01'],
};

// Heavy Operations budget (docs/NON_FUNCTIONAL_REQUIREMENTS.md) is a ceiling
// (<=30s), not a target to run close to - k6's threshold is set well under
// it so a genuine regression still fails loudly long before 30s.
export const ANALYTICS_THRESHOLDS = {
  http_req_duration: ['max<30000', 'p(95)<5000'],
  http_req_failed: ['rate<0.01'],
};

export function authHeaders(token) {
  return { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } };
}

export const JSON_HEADERS = { headers: { 'Content-Type': 'application/json' } };
