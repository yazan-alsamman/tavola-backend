// Phase 2.12 performance smoke test — simple measurements only.
// Run against the host-run backend on http://localhost:3100, backed by the
// same tavla_test PostgreSQL/Redis containers used for integration/e2e tests.
import { PrismaClient } from '@prisma/client';
import argon2 from 'argon2';
import { randomUUID } from 'crypto';

const BASE = 'http://localhost:3100/api/v1';
const prisma = new PrismaClient({
  datasources: { db: { url: 'postgresql://tavla:tavla_test_password@localhost:5433/tavla_test?schema=public' } },
});

function percentile(sorted, p) {
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

function summarize(label, samples) {
  const sorted = [...samples].sort((a, b) => a - b);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(
    `${label.padEnd(28)} n=${String(samples.length).padEnd(3)} avg=${avg.toFixed(1)}ms  p50=${percentile(sorted, 50).toFixed(1)}ms  p95=${percentile(sorted, 95).toFixed(1)}ms  min=${sorted[0].toFixed(1)}ms  max=${sorted[sorted.length - 1].toFixed(1)}ms`,
  );
  return { label, n: samples.length, avg, p50: percentile(sorted, 50), p95: percentile(sorted, 95), min: sorted[0], max: sorted[sorted.length - 1] };
}

async function timed(fn) {
  const start = performance.now();
  const result = await fn();
  const ms = performance.now() - start;
  return { result, ms };
}

async function seedUser(email, plainPassword) {
  const hash = await argon2.hash(plainPassword, {
    type: argon2.argon2id,
    memoryCost: 65536,
    timeCost: 3,
    parallelism: 1,
  });
  const id = randomUUID();
  await prisma.user.create({
    data: {
      id,
      firstName: 'Perf',
      lastName: 'Smoke',
      email,
      passwordHash: hash,
      language: 'en',
      status: 'Active',
      emailVerified: true,
    },
  });
  return id;
}

async function login(email, password) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password, deviceName: 'perf-smoke', deviceType: 'web' }),
  });
  if (!res.ok) {
    throw new Error(`login failed: ${res.status} ${await res.text()}`);
  }
  const body = await res.json();
  return body.data;
}

async function main() {
  const results = [];
  const password = 'PerfSmokeTest1!Strong';

  console.log('--- Phase 2.12 performance smoke test ---');
  console.log(`Target: ${BASE}\n`);

  // 1. Login (n=20, fresh user each call to avoid maxActiveSessionsPerUser=10 cap)
  const loginSamples = [];
  const seededUsers = [];
  for (let i = 0; i < 20; i++) {
    const email = `perf-login-${randomUUID()}@example.com`;
    await seedUser(email, password);
    const { ms } = await timed(() => login(email, password));
    loginSamples.push(ms);
    seededUsers.push(email);
  }
  results.push(summarize('Login', loginSamples));

  // Set up one persistent authenticated session for refresh/logout/change-password/session-listing measurements.
  const mainEmail = `perf-main-${randomUUID()}@example.com`;
  await seedUser(mainEmail, password);
  let session = await login(mainEmail, password);

  // 2. Refresh (n=20, sequential rotation — each call must use the newest refreshToken)
  const refreshSamples = [];
  for (let i = 0; i < 20; i++) {
    const { result, ms } = await timed(async () => {
      const res = await fetch(`${BASE}/auth/refresh`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: session.refreshToken }),
      });
      if (!res.ok) throw new Error(`refresh failed: ${res.status} ${await res.text()}`);
      return (await res.json()).data;
    });
    session = { ...session, accessToken: result.accessToken, refreshToken: result.refreshToken };
    refreshSamples.push(ms);
  }
  results.push(summarize('Refresh', refreshSamples));

  // 3. Session Listing (n=20)
  const listSamples = [];
  for (let i = 0; i < 20; i++) {
    const { ms } = await timed(async () => {
      const res = await fetch(`${BASE}/auth/sessions`, {
        headers: { Authorization: `Bearer ${session.accessToken}` },
      });
      if (!res.ok) throw new Error(`session list failed: ${res.status} ${await res.text()}`);
      return res.json();
    });
    listSamples.push(ms);
  }
  results.push(summarize('Session Listing', listSamples));

  // 4. Change Password (n=10, sequential). change-password bumps sessionVersion
  // but does NOT return a new access token (see ChangePasswordResponseDto) — the
  // access token used to make the call becomes stale (StaleSessionVersionException)
  // the instant the call succeeds, even though the underlying session/refresh
  // token are preserved. A real client must call /auth/refresh immediately
  // afterward to keep operating; we do the same here between iterations.
  const changeSamples = [];
  let currentPassword = password;
  for (let i = 0; i < 10; i++) {
    const newPassword = `PerfSmokeRotate${i}!Strong`;
    const { ms } = await timed(async () => {
      const res = await fetch(`${BASE}/auth/change-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.accessToken}` },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      if (!res.ok) throw new Error(`change-password failed: ${res.status} ${await res.text()}`);
      return res.json();
    });
    currentPassword = newPassword;
    changeSamples.push(ms);

    const refreshRes = await fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!refreshRes.ok) {
      throw new Error(`post-change-password refresh failed: ${refreshRes.status} ${await refreshRes.text()}`);
    }
    const refreshed = (await refreshRes.json()).data;
    session = { ...session, accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken };
  }
  results.push(summarize('Change Password', changeSamples));

  // 5. Logout (n=20, fresh login each time since logout revokes the session)
  const logoutSamples = [];
  for (let i = 0; i < 20; i++) {
    const s = await login(mainEmail, currentPassword);
    const { ms } = await timed(async () => {
      const res = await fetch(`${BASE}/auth/logout`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${s.accessToken}` },
      });
      if (!res.ok) throw new Error(`logout failed: ${res.status}`);
    });
    logoutSamples.push(ms);
  }
  results.push(summarize('Logout', logoutSamples));

  // 6. Concurrent Refresh (10 distinct sessions, one concurrent refresh burst each)
  const concurrentRefreshEmails = [];
  const concurrentRefreshSessions = [];
  for (let i = 0; i < 10; i++) {
    const email = `perf-concurrent-refresh-${randomUUID()}@example.com`;
    await seedUser(email, password);
    concurrentRefreshEmails.push(email);
    concurrentRefreshSessions.push(await login(email, password));
  }
  const { ms: concurrentRefreshWallMs, result: concurrentRefreshResults } = await timed(() =>
    Promise.all(
      concurrentRefreshSessions.map((s) =>
        timed(async () => {
          const res = await fetch(`${BASE}/auth/refresh`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ refreshToken: s.refreshToken }),
          });
          if (!res.ok) throw new Error(`concurrent refresh failed: ${res.status} ${await res.text()}`);
        }),
      ),
    ),
  );
  results.push(summarize('Concurrent Refresh (x10)', concurrentRefreshResults.map((r) => r.ms)));
  console.log(`  wall-clock for the 10-way concurrent batch: ${concurrentRefreshWallMs.toFixed(1)}ms`);

  // 7. Concurrent Change Password (same session, 5 concurrent requests racing the CAS — exactly one should succeed)
  const raceEmail = `perf-race-changepw-${randomUUID()}@example.com`;
  await seedUser(raceEmail, password);
  const raceSession = await login(raceEmail, password);
  const { ms: concurrentChangeWallMs, result: concurrentChangeResults } = await timed(() =>
    Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        timed(async () => {
          const res = await fetch(`${BASE}/auth/change-password`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${raceSession.accessToken}`,
            },
            body: JSON.stringify({ currentPassword: password, newPassword: `PerfRace${i}!Strong` }),
          });
          return res.status;
        }),
      ),
    ),
  );
  results.push(summarize('Concurrent Change Password (x5)', concurrentChangeResults.map((r) => r.ms)));
  console.log(`  wall-clock for the 5-way concurrent batch: ${concurrentChangeWallMs.toFixed(1)}ms`);
  console.log(`  status codes: ${concurrentChangeResults.map((r) => r.result).join(', ')} (expect exactly one 200, rest 401)`);

  console.log('\n--- Summary (JSON) ---');
  console.log(JSON.stringify(results, null, 2));

  // Cleanup
  await prisma.deviceSession.deleteMany({ where: { user: { email: { startsWith: 'perf-' } } } });
  await prisma.tokenFamily.deleteMany({ where: { user: { email: { startsWith: 'perf-' } } } });
  await prisma.passwordHistory.deleteMany({ where: { user: { email: { startsWith: 'perf-' } } } });
  await prisma.passwordResetToken.deleteMany({ where: { user: { email: { startsWith: 'perf-' } } } });
  await prisma.user.deleteMany({ where: { email: { startsWith: 'perf-' } } });
  await prisma.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await prisma.$disconnect();
  process.exit(1);
});
