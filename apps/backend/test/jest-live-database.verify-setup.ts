import verifyEnv from './support/verify-env.json';

// Single source of truth shared with scripts/run-strict-tests.js, which sets
// these same values at the OS-process level before Jest even starts - see
// that file's own comment for why this setupFiles copy alone is too late for
// Jest's globalSetup to observe REQUIRE_LIVE_DATABASE.
for (const [key, value] of Object.entries(verifyEnv)) {
  process.env[key] = value;
}
