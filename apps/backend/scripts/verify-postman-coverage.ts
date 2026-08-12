/**
 * Verifies that the canonical Postman collection
 * (postman/TAVLA-API.postman_collection.json) has exact route coverage of
 * every HTTP endpoint actually implemented by the NestJS backend.
 *
 * Source of truth: the compiled route table below is derived purely from
 * the `*.controller.ts` AST (via the TypeScript compiler API) - never from
 * a manually maintained list - plus the runtime prefix/versioning
 * configuration in `src/main.ts` (`setGlobalPrefix('api')` +
 * `enableVersioning({ type: URI, defaultVersion: '1' })`, mirrored here as
 * constants since importing `main.ts` would require booting Nest).
 *
 * Usage: npx tsx scripts/verify-postman-coverage.ts
 * Exit code: 0 = exact coverage, 1 = mismatch (missing/extra/duplicate/method).
 */
import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

const GLOBAL_PREFIX = 'api';
const DEFAULT_VERSION = 'v1';

const SRC_ROOT = path.resolve(__dirname, '..', 'src');
const COLLECTION_PATH = path.resolve(
  __dirname,
  '..',
  'postman',
  'TAVLA-API.postman_collection.json',
);

const HTTP_DECORATORS = new Set(['Get', 'Post', 'Put', 'Patch', 'Delete', 'Options', 'Head']);

interface SourceRoute {
  method: string;
  path: string; // canonical, e.g. /api/v1/restaurants/:restaurantId/branches/:branchId
  normalized: string; // method + structurally-normalized path, used for matching
  controllerFile: string;
  handlerName: string;
}

interface PostmanRoute {
  method: string;
  path: string;
  normalized: string;
  requestName: string;
  folderTrail: string;
}

// ---------------------------------------------------------------------------
// 1. Walk the filesystem for *.controller.ts files
// ---------------------------------------------------------------------------

function findControllerFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      findControllerFiles(full, out);
    } else if (entry.isFile() && entry.name.endsWith('.controller.ts')) {
      out.push(full);
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// 2. AST helpers
// ---------------------------------------------------------------------------

function stringLiteralValue(node: ts.Node | undefined): string | undefined {
  if (!node) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
    return node.text;
  }
  return undefined;
}

/** Extracts the `path` argument of a @Controller()/@Get()/etc. decorator call. */
function extractDecoratorPaths(callExpr: ts.CallExpression): string[] {
  const [arg] = callExpr.arguments;
  if (!arg) return [''];

  const literal = stringLiteralValue(arg);
  if (literal !== undefined) return [literal];

  if (ts.isArrayLiteralExpression(arg)) {
    const values = arg.elements.map(stringLiteralValue).filter((v): v is string => v !== undefined);
    return values.length > 0 ? values : [''];
  }

  if (ts.isObjectLiteralExpression(arg)) {
    for (const prop of arg.properties) {
      if (
        ts.isPropertyAssignment(prop) &&
        ts.isIdentifier(prop.name) &&
        prop.name.text === 'path'
      ) {
        const value = prop.initializer;
        const single = stringLiteralValue(value);
        if (single !== undefined) return [single];
        if (ts.isArrayLiteralExpression(value)) {
          const values = value.elements
            .map(stringLiteralValue)
            .filter((v): v is string => v !== undefined);
          return values.length > 0 ? values : [''];
        }
      }
    }
    // @Controller({ version: '1' }) with no `path` -> root
    return [''];
  }

  return [''];
}

function getDecoratorCall(decorator: ts.Decorator): ts.CallExpression | undefined {
  return ts.isCallExpression(decorator.expression) ? decorator.expression : undefined;
}

function decoratorName(callExpr: ts.CallExpression): string | undefined {
  const expr = callExpr.expression;
  return ts.isIdentifier(expr) ? expr.text : undefined;
}

function joinRoute(...segments: string[]): string {
  const cleaned = segments
    .map((s) => s.trim().replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter((s) => s.length > 0);
  return '/' + cleaned.join('/');
}

// ---------------------------------------------------------------------------
// 3. Extract routes from a single controller file
// ---------------------------------------------------------------------------

function extractRoutesFromFile(filePath: string): SourceRoute[] {
  const sourceText = fs.readFileSync(filePath, 'utf-8');
  const sourceFile = ts.createSourceFile(
    filePath,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );

  const routes: SourceRoute[] = [];

  function visit(node: ts.Node): void {
    if (ts.isClassDeclaration(node)) {
      const decorators = ts.getDecorators?.(node) ?? [];
      const controllerDecorator = decorators
        .map(getDecoratorCall)
        .find((call): call is ts.CallExpression => !!call && decoratorName(call) === 'Controller');

      if (controllerDecorator) {
        const controllerPaths = extractDecoratorPaths(controllerDecorator);

        for (const member of node.members) {
          if (!ts.isMethodDeclaration(member)) continue;
          const methodDecorators = ts.getDecorators?.(member) ?? [];

          for (const dec of methodDecorators) {
            const call = getDecoratorCall(dec);
            if (!call) continue;
            const name = decoratorName(call);
            if (!name || !HTTP_DECORATORS.has(name)) continue;

            const methodPaths = extractDecoratorPaths(call);
            const handlerName = ts.isIdentifier(member.name) ? member.name.text : '<computed>';

            for (const controllerPath of controllerPaths) {
              for (const methodPath of methodPaths) {
                const combined = joinRoute(GLOBAL_PREFIX, DEFAULT_VERSION, controllerPath, methodPath);
                routes.push({
                  method: name.toUpperCase(),
                  path: combined,
                  normalized: normalizeRoute(name.toUpperCase(), combined),
                  controllerFile: path.relative(SRC_ROOT, filePath).replace(/\\/g, '/'),
                  handlerName,
                });
              }
            }
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return routes;
}

/** Structural normalization: any `:param` segment collapses to `:param` so that
 * `/branches/:branchId` and `/branches/{{branchId}}` compare equal, per spec
 * section 2 ("must not be treated as a different endpoint"). */
function normalizeRoute(method: string, routePath: string): string {
  const segments = routePath
    .split('/')
    .filter((s) => s.length > 0)
    .map((segment) => {
      if (segment.startsWith(':')) return ':param';
      if (/^\{\{[a-zA-Z0-9_]+\}\}$/.test(segment)) return ':param';
      return segment;
    });
  return `${method} /${segments.join('/')}`;
}

// ---------------------------------------------------------------------------
// 4. Extract routes from the Postman collection
// ---------------------------------------------------------------------------

interface PostmanItem {
  name: string;
  item?: PostmanItem[];
  request?: {
    method: string;
    url?: { raw?: string } | string;
  };
}

function extractPostmanRoutes(): PostmanRoute[] {
  const collection = JSON.parse(fs.readFileSync(COLLECTION_PATH, 'utf-8')) as {
    item: PostmanItem[];
  };

  const routes: PostmanRoute[] = [];

  function walk(items: PostmanItem[], trail: string): void {
    for (const item of items) {
      const nextTrail = trail ? `${trail} / ${item.name}` : item.name;
      if (item.item) {
        walk(item.item, nextTrail);
        continue;
      }
      if (!item.request) continue;

      const method = item.request.method?.toUpperCase();
      if (!method) continue;

      let raw = typeof item.request.url === 'string' ? item.request.url : item.request.url?.raw;
      if (!raw) continue;

      // {{baseUrl}} resolves to https://.../api/{{version}} in the committed
      // environment (see postman/TAVLA-API.postman_environment.json) - it
      // already embeds the global prefix + default version.
      raw = raw.replace(/\{\{baseUrl\}\}/g, `/${GLOBAL_PREFIX}/${DEFAULT_VERSION}`).split('?')[0];
      if (!raw.startsWith('/')) raw = '/' + raw;

      routes.push({
        method,
        path: raw,
        normalized: normalizeRoute(method, raw),
        requestName: item.name,
        folderTrail: nextTrail,
      });
    }
  }

  walk(collection.item, '');
  return routes;
}

// ---------------------------------------------------------------------------
// 5. Compare
// ---------------------------------------------------------------------------

function countBy<T>(items: T[], keyFn: (item: T) => string): Map<string, T[]> {
  const map = new Map<string, T[]>();
  for (const item of items) {
    const key = keyFn(item);
    const bucket = map.get(key);
    if (bucket) bucket.push(item);
    else map.set(key, [item]);
  }
  return map;
}

function main(): void {
  const controllerFiles = findControllerFiles(SRC_ROOT);
  const sourceRoutes = controllerFiles.flatMap(extractRoutesFromFile);
  const postmanRoutes = extractPostmanRoutes();

  const sourceByKey = countBy(sourceRoutes, (r) => r.normalized);
  const postmanByKey = countBy(postmanRoutes, (r) => r.normalized);

  const missing: SourceRoute[] = [];
  const duplicates: { key: string; requests: PostmanRoute[] }[] = [];

  for (const [key, srcGroup] of sourceByKey) {
    const pmGroup = postmanByKey.get(key) ?? [];
    if (pmGroup.length === 0) {
      missing.push(...srcGroup);
    } else if (pmGroup.length > 1) {
      duplicates.push({ key, requests: pmGroup });
    }
  }

  const extra: PostmanRoute[] = [];
  for (const [key, pmGroup] of postmanByKey) {
    if (!sourceByKey.has(key)) {
      extra.push(...pmGroup);
    }
  }

  const sourceKeys = new Set(sourceRoutes.map((r) => r.normalized));
  const methodMismatches: { source: SourceRoute; postman: PostmanRoute }[] = [];
  for (const pmRoute of postmanRoutes) {
    if (sourceKeys.has(pmRoute.normalized)) continue;
    const pathOnlyMatches = sourceRoutes.filter(
      (s) => normalizeRoute('X', s.path) === normalizeRoute('X', pmRoute.path),
    );
    if (pathOnlyMatches.length > 0 && !sourceByKey.has(pmRoute.normalized)) {
      methodMismatches.push({ source: pathOnlyMatches[0], postman: pmRoute });
    }
  }

  const dedupedExtra = extra.filter(
    (e) => !methodMismatches.some((m) => m.postman === e),
  );
  const dedupedMissing = missing.filter(
    (m) => !methodMismatches.some((mm) => mm.source.normalized === m.normalized),
  );

  console.log('='.repeat(70));
  console.log('TAVLA Postman Coverage Verifier');
  console.log('='.repeat(70));
  console.log(`Controllers scanned:      ${controllerFiles.length}`);
  console.log(`Source routes (unique):   ${sourceByKey.size}`);
  console.log(`Source routes (total):    ${sourceRoutes.length}`);
  console.log(`Postman requests:         ${postmanRoutes.length}`);
  console.log(`Missing from Postman:     ${dedupedMissing.length}`);
  console.log(`Extra in Postman:         ${dedupedExtra.length}`);
  console.log(`Duplicate Postman routes: ${duplicates.length}`);
  console.log(`Method/path mismatches:   ${methodMismatches.length}`);
  const coverage =
    sourceByKey.size === 0 ? 100 : ((sourceByKey.size - dedupedMissing.length) / sourceByKey.size) * 100;
  console.log(`Coverage:                 ${coverage.toFixed(2)}%`);
  console.log('='.repeat(70));

  if (dedupedMissing.length > 0) {
    console.log('\n--- MISSING (implemented, not in Postman) ---');
    for (const r of dedupedMissing) {
      console.log(`  ${r.method.padEnd(7)} ${r.path}   [${r.controllerFile}#${r.handlerName}]`);
    }
  }

  if (dedupedExtra.length > 0) {
    console.log('\n--- EXTRA (in Postman, no matching source route) ---');
    for (const r of dedupedExtra) {
      console.log(`  ${r.method.padEnd(7)} ${r.path}   ["${r.folderTrail}"]`);
    }
  }

  if (duplicates.length > 0) {
    console.log('\n--- DUPLICATES (same route, multiple Postman requests) ---');
    for (const d of duplicates) {
      console.log(`  ${d.key}`);
      for (const r of d.requests) {
        console.log(`    - "${r.folderTrail}"`);
      }
    }
  }

  if (methodMismatches.length > 0) {
    console.log('\n--- METHOD/PATH MISMATCHES ---');
    for (const m of methodMismatches) {
      console.log(
        `  source: ${m.source.method} ${m.source.path}  vs  postman: ${m.postman.method} ${m.postman.path}  ["${m.postman.folderTrail}"]`,
      );
    }
  }

  const ok =
    dedupedMissing.length === 0 &&
    dedupedExtra.length === 0 &&
    duplicates.length === 0 &&
    methodMismatches.length === 0;

  console.log('\n' + (ok ? 'PASS: exact coverage.' : 'FAIL: coverage mismatch.'));
  process.exit(ok ? 0 : 1);
}

main();
