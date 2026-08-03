/**
 * Second-pass verification: re-scan every NestJS controller from source
 * and assert every endpoint exists exactly once in the Postman collection.
 */
const fs = require('fs');
const path = require('path');

function walk(dir, acc = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, acc);
    else if (e.name.endsWith('.controller.ts') && !e.name.endsWith('.spec.ts')) acc.push(p);
  }
  return acc;
}

function getControllerMeta(src) {
  const match = src.match(/@Controller\(([\s\S]*?)\)\s*(?:@(?:ApiTags|ApiExcludeController|UseGuards|ApiExtraModels)[^\n]*\s*)*export class/);
  const argsMatch = src.match(/@Controller\(([\s\S]*?)\)/);
  const args = (match ? match[1] : argsMatch ? argsMatch[1] : "''").trim();
  let basePath = '';
  let version = null;
  if (args.startsWith('{')) {
    const pathMatch = args.match(/path:\s*['"`]([^'"`]*)['"`]/);
    if (pathMatch) basePath = pathMatch[1];
    const verMatch = args.match(/version:\s*['"`]?([^'"`},\s]+)['"`]?/);
    if (verMatch) version = String(verMatch[1]);
  } else if (/^['"`]/.test(args)) {
    basePath = args.slice(1, -1);
  }
  // Nest defaultVersion = '1' applies when version omitted
  if (!version) version = '1';
  return { basePath, version };
}

function joinPath(...parts) {
  return (
    '/' +
    parts
      .filter(Boolean)
      .map((p) => String(p).replace(/^\/+|\/+$/g, ''))
      .filter(Boolean)
      .join('/')
  ).replace(/\/+/g, '/');
}

function normKey(method, p) {
  const n = p
    .replace(/\{\{[^}]+\}\}/g, ':param')
    .replace(/:[a-zA-Z_][\w]*/g, ':param')
    .replace(/\/+/g, '/')
    .replace(/\/$/, '')
    .toLowerCase() || '/';
  return method.toUpperCase() + ' ' + n;
}

const srcRoot = path.join(__dirname, '..', 'src');
const controllers = walk(srcRoot);
const backend = [];

for (const file of controllers) {
  const src = fs.readFileSync(file, 'utf8');
  const { basePath, version } = getControllerMeta(src);
  const methodRegex = /@(Get|Post|Put|Patch|Delete|Head|Options|All)\((?:(['`])([^'`]*)\2)?\)/g;
  let m;
  while ((m = methodRegex.exec(src)) !== null) {
    const method = m[1].toUpperCase();
    const route = m[3] || '';
    const apiPath = joinPath('api', `v${version}`, basePath, route);
    const rel = joinPath(basePath, route);
    backend.push({
      method,
      apiPath,
      rel,
      key: normKey(method, rel),
      file: file.replace(/\\/g, '/').replace(/.*\/src\//, 'src/'),
    });
  }
}

const col = JSON.parse(fs.readFileSync(path.join(__dirname, 'TAVLA-API.postman_collection.json'), 'utf8'));

function walkItems(items, acc = []) {
  for (const it of items || []) {
    if (it.item) walkItems(it.item, acc);
    else if (it.request) {
      const r = it.request;
      let url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
      let p = url.replace(/\{\{baseUrl\}\}/g, '').split('?')[0];
      if (!p.startsWith('/')) p = '/' + p.replace(/^\//, '');
      acc.push({
        name: it.name,
        method: r.method,
        path: p,
        key: normKey(r.method, p),
        hasDescription: !!(r.description && String(r.description).includes('## Purpose')),
        auth: r.auth?.type || 'inherit',
      });
    }
  }
  return acc;
}

const requests = walkItems(col.item);
const backendMap = new Map();
for (const b of backend) {
  if (!backendMap.has(b.key)) backendMap.set(b.key, []);
  backendMap.get(b.key).push(b);
}
const colMap = new Map();
for (const r of requests) {
  if (!colMap.has(r.key)) colMap.set(r.key, []);
  colMap.get(r.key).push(r);
}

const missing = [...backendMap.keys()].filter((k) => !colMap.has(k));
const extra = [...colMap.keys()].filter((k) => !backendMap.has(k));
const dupsBackend = [...backendMap.entries()].filter(([, v]) => v.length > 1);
const dupsCol = [...colMap.entries()].filter(([, v]) => v.length > 1);
const undocumented = requests.filter((r) => !r.hasDescription);

const folders = (col.item || []).map((f) => `${f.name}: ${(f.item || []).length}`);

const summary = {
  controllersScanned: controllers.length,
  backendEndpoints: backend.length,
  collectionRequests: requests.length,
  missingCount: missing.length,
  extraCount: extra.length,
  backendDuplicateKeys: dupsBackend.length,
  collectionDuplicateKeys: dupsCol.length,
  undocumentedCount: undocumented.length,
  missing,
  extra,
  dupsBackend: dupsBackend.map(([k, v]) => ({ key: k, count: v.length })),
  dupsCol: dupsCol.map(([k, v]) => ({ key: k, count: v.length, names: v.map((x) => x.name) })),
  folders,
  pass:
    missing.length === 0 &&
    extra.length === 0 &&
    dupsCol.length === 0 &&
    backend.length === requests.length,
};

fs.writeFileSync(path.join(__dirname, '_second_pass_verification.json'), JSON.stringify(summary, null, 2));

console.log('Second-pass controllers:', summary.controllersScanned);
console.log('Backend endpoints:', summary.backendEndpoints);
console.log('Collection requests:', summary.collectionRequests);
console.log('Missing:', summary.missingCount);
console.log('Extra:', summary.extraCount);
console.log('Collection dups:', summary.collectionDuplicateKeys);
console.log('Backend dups (same route twice):', summary.backendDuplicateKeys);
console.log('Undocumented:', summary.undocumentedCount);
console.log('Folders:\n', folders.join('\n'));
console.log(summary.pass ? 'SECOND PASS PASS — zero backend endpoints missing.' : 'SECOND PASS FAIL');
if (!summary.pass) {
  console.log('Missing', missing);
  console.log('Extra', extra);
  console.log('Dups', summary.dupsCol);
  process.exit(1);
}
