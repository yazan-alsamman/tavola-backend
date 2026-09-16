/**
 * Executes the `03 - Platform Owner` folder of the canonical Postman
 * collection against a RUNNING backend and checks each response against the
 * examples stored in the collection.
 *
 * This is the companion to `verify-postman-coverage.ts`: that script proves
 * the collection's route table matches the compiled controllers (static);
 * this one proves the collection's *documented behaviour* matches what the
 * server actually returns (dynamic). Coverage alone cannot catch a request
 * whose stored example claims a field the API never emits, or a filter the
 * API silently ignores.
 *
 * For every request it reports:
 *   - the observed HTTP status,
 *   - whether that status appears among the stored examples,
 *   - for 2xx JSON responses, any key present in the stored example's `data`
 *     but absent from the live `data` (a stale/invented example field), and
 *     any key the live response returns that the example omits.
 *
 * Usage:
 *   npx tsx scripts/verify-postman-live.ts [baseUrl]
 * Exit code: 0 = every executed request matched a documented example shape.
 */
import * as fs from 'fs';
import * as path from 'path';

const BASE_URL = process.argv[2] ?? 'http://localhost:3000/api/v1';
const COLLECTION_PATH = path.resolve(
  __dirname,
  '..',
  'postman',
  'TAVLA-API.postman_collection.json',
);

interface PostmanQuery {
  key: string;
  value: string;
  disabled?: boolean;
}
interface PostmanUrl {
  raw?: string;
  path?: string[];
  query?: PostmanQuery[];
}
interface PostmanResponse {
  name: string;
  code: number;
  body?: string;
}
interface PostmanRequestDef {
  method: string;
  url: PostmanUrl | string;
  body?: { mode?: string; raw?: string };
  auth?: { type: string };
}
interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: PostmanRequestDef;
  response?: PostmanResponse[];
}

const vars: Record<string, string> = {};

function resolveVars(input: string): string {
  return input.replace(/\{\{(\w+)\}\}/g, (match, key: string) =>
    vars[key] !== undefined ? vars[key] : match,
  );
}

function buildUrl(url: PostmanUrl | string): string {
  const raw = typeof url === 'string' ? url : (url.raw ?? '');
  // `{{baseUrl}}` is substituted FIRST, and `baseUrl` is deleted from the
  // variable map at startup. The collection ships a production value for it
  // (`https://api.tavola.business/api/v1`); resolving variables first would
  // silently expand to that and send this script's requests to the live
  // production host instead of the target under test.
  return resolveVars(raw.split('{{baseUrl}}').join(BASE_URL));
}

function flatten(items: PostmanItem[], trail: string[] = []): Array<{ trail: string[]; item: PostmanItem }> {
  const out: Array<{ trail: string[]; item: PostmanItem }> = [];
  for (const item of items) {
    if (item.item) {
      out.push(...flatten(item.item, [...trail, item.name]));
    } else if (item.request) {
      out.push({ trail: [...trail, item.name], item });
    }
  }
  return out;
}

/** Keys of `data`, one level deep, so list endpoints compare their row shape too. */
function shapeOf(data: unknown): Set<string> {
  const keys = new Set<string>();
  if (data === null || typeof data !== 'object') return keys;
  const record = data as Record<string, unknown>;
  for (const [key, value] of Object.entries(record)) {
    keys.add(key);
    if (key === 'items' && Array.isArray(value) && value.length > 0 && typeof value[0] === 'object') {
      for (const rowKey of Object.keys(value[0] as Record<string, unknown>)) {
        keys.add(`items[].${rowKey}`);
      }
    }
  }
  return keys;
}

interface Finding {
  request: string;
  kind: 'undocumented-status' | 'example-only-field' | 'live-only-field' | 'transport-error';
  detail: string;
}

async function main(): Promise<void> {
  const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf8')) as {
    item: PostmanItem[];
    variable?: Array<{ key: string; value: string }>;
  };

  for (const v of collection.variable ?? []) {
    vars[v.key] = v.value;
  }
  // Never let the collection's own production `baseUrl` reach a request URL.
  delete vars.baseUrl;

  if (!/^https?:\/\/(localhost|127\.0\.0\.1)(:|\/)/.test(BASE_URL)) {
    throw new Error(
      `Refusing to run against a non-local target: ${BASE_URL}. ` +
        'This script executes real requests and is intended for a local backend under test.',
    );
  }

  const owner = collection.item.find((i) => i.name === '03 - Platform Owner');
  if (!owner?.item) throw new Error('03 - Platform Owner folder not found');

  // --- Authenticate, and seed the ids the folder's requests reference. ---
  const adminEmail = process.env.PA_EMAIL;
  const adminPassword = process.env.PA_PASSWORD;
  if (!adminEmail || !adminPassword) {
    throw new Error('Set PA_EMAIL and PA_PASSWORD to a seeded Platform Admin.');
  }

  const loginResponse = await fetch(`${BASE_URL}/platform-admin/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: adminEmail, password: adminPassword }),
  });
  const loginBody = (await loginResponse.json()) as {
    data?: { accessToken?: string; refreshToken?: string };
  };
  if (!loginResponse.ok || !loginBody.data?.accessToken) {
    throw new Error(`Platform Admin login failed: ${loginResponse.status}`);
  }
  vars.platformAdminAccessToken = loginBody.data.accessToken;
  vars.platformAdminRefreshToken = loginBody.data.refreshToken ?? '';
  console.log(`Authenticated as ${adminEmail}\n`);

  for (const [key, value] of Object.entries(process.env)) {
    if (key.startsWith('PM_VAR_') && value) {
      vars[key.slice('PM_VAR_'.length)] = value;
    }
  }

  const findings: Finding[] = [];
  let executed = 0;
  let skipped = 0;

  // Only GETs are executed by default: the folder's POSTs are real mutations
  // (suspend/delete/broadcast) and running them against a live database would
  // change state this script has no mandate to change. Login/refresh/logout
  // are exercised explicitly above and below instead.
  const EXECUTE_METHODS = new Set(['GET']);

  for (const { trail, item } of flatten(owner.item)) {
    const req = item.request!;
    const name = trail.join(' / ');
    const method = req.method.toUpperCase();

    if (!EXECUTE_METHODS.has(method)) {
      skipped += 1;
      continue;
    }

    const url = buildUrl(req.url);
    if (url.includes('{{')) {
      console.log(`SKIP  ${name}\n      unresolved variable in ${url}`);
      skipped += 1;
      continue;
    }
    // A path variable that resolved to the empty string collapses
    // `/restaurants/{{restaurantId}}` into `/restaurants/`, which silently
    // hits the LIST route and would be reported as a bogus shape mismatch
    // against the detail example. Treat it as unresolved instead.
    const [pathPart] = url.split('?');
    if (/\/\/|\/$/.test(pathPart.replace(/^https?:\/\//, ''))) {
      console.log(`SKIP  ${name}\n      empty path variable in ${url}`);
      skipped += 1;
      continue;
    }

    let status: number;
    let json: unknown;
    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${vars.platformAdminAccessToken}`,
          Accept: 'application/json',
        },
      });
      status = response.status;
      const text = await response.text();
      json = text ? JSON.parse(text) : undefined;
    } catch (error) {
      findings.push({
        request: name,
        kind: 'transport-error',
        detail: (error as Error).message,
      });
      console.log(`ERR   ${name}: ${(error as Error).message}`);
      continue;
    }

    executed += 1;

    const examples = item.response ?? [];
    const documented = examples.map((e) => e.code);
    const match = examples.find((e) => e.code === status);

    if (!match) {
      findings.push({
        request: name,
        kind: 'undocumented-status',
        detail: `live ${status}, documented [${documented.join(', ')}]`,
      });
      console.log(`FAIL  ${name}\n      live ${status} not among documented [${documented.join(', ')}]`);
      continue;
    }

    if (status >= 200 && status < 300 && match.body) {
      const exampleBody = JSON.parse(match.body) as { data?: unknown };
      const liveBody = json as { data?: unknown };
      const exampleShape = shapeOf(exampleBody.data);
      const liveShape = shapeOf(liveBody?.data);

      const exampleOnly = [...exampleShape].filter((k) => !liveShape.has(k));
      const liveOnly = [...liveShape].filter((k) => !exampleShape.has(k));

      // An example row can legitimately be absent when the live list is empty.
      const liveItemsEmpty =
        typeof liveBody?.data === 'object' &&
        liveBody?.data !== null &&
        Array.isArray((liveBody.data as Record<string, unknown>).items) &&
        ((liveBody.data as Record<string, unknown>).items as unknown[]).length === 0;

      const realExampleOnly = liveItemsEmpty
        ? exampleOnly.filter((k) => !k.startsWith('items[].'))
        : exampleOnly;

      if (realExampleOnly.length > 0) {
        findings.push({
          request: name,
          kind: 'example-only-field',
          detail: realExampleOnly.join(', '),
        });
      }
      if (liveOnly.length > 0) {
        findings.push({ request: name, kind: 'live-only-field', detail: liveOnly.join(', ') });
      }

      const flag = realExampleOnly.length || liveOnly.length ? 'WARN' : 'OK  ';
      console.log(`${flag}  ${name} -> ${status}`);
      if (realExampleOnly.length) console.log(`      example-only fields: ${realExampleOnly.join(', ')}`);
      if (liveOnly.length) console.log(`      live-only fields:    ${liveOnly.join(', ')}`);
    } else {
      console.log(`OK    ${name} -> ${status}`);
    }
  }

  console.log('\n======================================================================');
  console.log(`Executed: ${executed}   Skipped (mutations/unresolved): ${skipped}`);
  console.log(`Findings: ${findings.length}`);
  for (const f of findings) {
    console.log(`  [${f.kind}] ${f.request}: ${f.detail}`);
  }
  console.log('======================================================================');

  process.exit(findings.length === 0 ? 0 : 1);
}

void main().catch((error) => {
  console.error(error);
  process.exit(1);
});
