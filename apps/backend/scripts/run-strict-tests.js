'use strict';

// Cross-platform launcher for `test:integration:verify` / `test:e2e:verify`.
//
// Jest's globalSetup (jest-live-database.global-setup.ts) runs once, before
// any worker or its setupFiles execute, in this same process. Setting
// REQUIRE_LIVE_DATABASE=true only inside a Jest `setupFiles` entry
// (jest-live-database.verify-setup.ts) is therefore too late for globalSetup
// to see it - it would silently fall back to non-strict defaults. Setting it
// here, before `jest.run()` is even called, makes it visible to globalSetup
// as well, so strict verification actually fails closed when required
// infrastructure is unreachable, instead of silently skipping.
//
// Implemented as a plain Node script (no shell syntax, no `VAR=value`
// prefix) so it behaves identically on Windows PowerShell/CMD, Linux, macOS,
// and CI. Uses Jest's own programmatic `run()` API rather than spawning a
// `jest` binary, avoiding platform-specific binary-shim resolution (`.cmd`
// vs POSIX shebang) entirely.

const path = require('path');
const verifyEnv = require('../test/support/verify-env.json');

const configPath = process.argv[2];
if (!configPath) {
  console.error('Usage: node scripts/run-strict-tests.js <jest-config-path>');
  process.exit(1);
}

Object.assign(process.env, verifyEnv);

const { run } = require('jest');

void run(
  ['--config', configPath, '--runInBand', ...process.argv.slice(3)],
  path.resolve(__dirname, '..'),
);
