/**
 * Rebuilds TAVLA Postman collection + environment from NestJS source inventory.
 * Source of truth: _endpoint_inventory.json (extracted from controllers).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = __dirname;
const SRC = path.join(ROOT, '..', 'src');
const inventory = JSON.parse(fs.readFileSync(path.join(ROOT, '_endpoint_inventory.json'), 'utf8'));
const existingBodies = JSON.parse(fs.readFileSync(path.join(ROOT, '_existing_bodies.json'), 'utf8'));
const oldCollection = JSON.parse(fs.readFileSync(path.join(ROOT, 'TAVLA-API.postman_collection.json'), 'utf8'));
const oldEnv = JSON.parse(fs.readFileSync(path.join(ROOT, 'TAVLA-API.postman_environment.json'), 'utf8'));

const EXAMPLE_UUID = '11111111-1111-4111-8111-111111111111';

function uuidFromKey(key) {
  const h = crypto.createHash('md5').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function walkDtoFiles(dir, acc = []) {
  if (!fs.existsSync(dir)) return acc;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkDtoFiles(p, acc);
    else if (/\.dto\.ts$/.test(e.name)) acc.push(p);
  }
  return acc;
}

/** Build map of DTO class name -> example object from @ApiProperty examples */
function buildDtoExamples() {
  const files = walkDtoFiles(SRC);
  const map = {};
  for (const file of files) {
    const src = fs.readFileSync(file, 'utf8');
    const classMatches = [...src.matchAll(/export class (\w+)/g)];
    for (const cm of classMatches) {
      const className = cm[1];
      const start = cm.index;
      const next = classMatches.find((x) => x.index > start);
      const chunk = src.slice(start, next ? next.index : src.length);
      const example = {};
      // Match property blocks: ApiProperty... then propertyName
      const propRegex =
        /@ApiProperty(?:Optional)?\((\{[\s\S]*?\})\)\s*(?:@\w+(?:\([^)]*\))?\s*)*([a-zA-Z_][\w]*)\s*[?!]?:/g;
      let m;
      while ((m = propRegex.exec(chunk)) !== null) {
        const meta = m[1];
        const prop = m[2];
        const exMatch = meta.match(/example:\s*((?:'[^']*'|"[^"]*"|`[^`]*`|-?\d+(?:\.\d+)?|true|false|\[[^\]]*\]|\{[^}]*\}))/);
        if (exMatch) {
          let raw = exMatch[1].trim();
          try {
            if (raw.startsWith("'") || raw.startsWith('`')) raw = JSON.stringify(raw.slice(1, -1));
            example[prop] = JSON.parse(raw.replace(/'/g, '"'));
          } catch {
            example[prop] = raw.replace(/^['"`]|['"`]$/g, '');
          }
        } else if (/enum:/.test(meta)) {
          const enumEx = meta.match(/example:\s*(\w+\.\w+)/);
          if (enumEx) example[prop] = enumEx[1].split('.').pop().toLowerCase();
        }
      }
      if (Object.keys(example).length) map[className] = example;
    }
  }
  return map;
}

const dtoExamples = buildDtoExamples();

function normalizePathKey(method, apiPath) {
  // apiPath like /api/v1/auth/login or /auth/login
  let p = apiPath.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
  if (!p.startsWith('/')) p = '/' + p;
  p = p.replace(/\/+/g, '/').replace(/\/$/, '') || '/';
  const norm = p.replace(/:[a-zA-Z_][\w]*/g, ':param').toLowerCase();
  return method.toUpperCase() + ' ' + norm;
}

function collectionRelativePath(apiPath) {
  // Path under {{baseUrl}} which is .../api/v1
  return apiPath.replace(/^\/api\/v1/, '').replace(/^\/api/, '') || '/';
}

function pathToSegments(relPath) {
  return relPath.replace(/^\//, '').split('/').filter(Boolean).map((seg) => {
    if (seg.startsWith(':')) {
      const name = seg.slice(1);
      const varName = paramToVar(name);
      return `{{${varName}}}`;
    }
    return seg;
  });
}

function paramToVar(name) {
  const map = {
    id: inferIdVar,
    restaurantId: 'restaurantId',
    branchId: 'branchId',
    floorPlanId: 'floorPlanId',
    tableId: 'tableId',
    employeeId: 'employeeId',
    menuId: 'menuId',
    categoryId: 'categoryId',
    itemId: 'itemId',
    addOnId: 'addOnId',
    optionGroupId: 'optionGroupId',
    optionId: 'optionId',
    offerId: 'offerId',
    galleryItemId: 'galleryItemId',
    sessionId: 'sessionId',
    conversationId: 'conversationId',
    imageId: 'reviewImageId',
    notificationId: 'notificationId',
  };
  if (name === 'id') return null; // contextual
  return map[name] || name;
}

function inferIdVar(ep) {
  const p = ep.path || '';
  if (p.includes('/reservations/')) return 'reservationId';
  if (p.includes('/reviews/')) return 'reviewId';
  if (p.includes('/waitlist/')) return 'waitlistEntryId';
  if (p.includes('/conversations/')) return 'conversationId';
  if (p.includes('/notifications/')) return 'notificationId';
  if (p.includes('/organizations/') && p.includes('/subscription')) return 'organizationId';
  if (p.includes('/restaurants/') && /\/restaurants\/:id(\/|$)/.test(p.replace('/api/v1', ''))) return 'restaurantId';
  return 'id';
}

function resolvePathSegments(ep) {
  const rel = collectionRelativePath(ep.path);
  return rel
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map((seg) => {
      if (!seg.startsWith(':')) return seg;
      const name = seg.slice(1);
      let v = paramToVar(name);
      if (v === null) v = inferIdVar(ep);
      if (name === 'id' && ep.path.includes('/platform-admin/organizations/')) v = 'organizationId';
      if (name === 'id' && /\/conversations\/:id/.test(ep.path)) v = 'conversationId';
      if (name === 'id' && /\/notifications\/:id/.test(ep.path)) v = 'notificationId';
      if (name === 'id' && /\/reviews\/:id/.test(ep.path)) v = 'reviewId';
      if (name === 'id' && /\/reservations\/:id/.test(ep.path)) v = 'reservationId';
      if (name === 'id' && /\/waitlist\/:id/.test(ep.path)) v = 'waitlistEntryId';
      if (name === 'id' && /\/restaurants\/:id/.test(ep.path)) v = 'restaurantId';
      return `{{${v}}}`;
    });
}

function roleLabel(ep) {
  const callers = Array.isArray(ep.caller) ? ep.caller.join('; ') : String(ep.caller || '');
  if (ep.isPublic || callers.toLowerCase().includes('public')) return 'Public';
  if (ep.guards?.PlatformAdminGuard) return 'Platform Admin';
  if (callers.includes('Customer') && callers.includes('Employee')) return 'Customer | Employee';
  if (callers.includes('Owner/Admin') && callers.includes('Employee')) return 'Restaurant Owner/Admin | Employee';
  if (callers.includes('Owner') && callers.includes('Admin') && callers.includes('Employee'))
    return 'Restaurant Owner/Admin | Employee';
  if (/Owner\/Admin|Owner\/Admin only|OrganizationMember/.test(callers) || ep.requireOrgRole)
    return 'Restaurant Owner/Admin';
  if (callers.includes('Employee')) return 'Employee';
  if (callers.includes('Customer') || ep.path.includes('/users/me') || ep.path.includes('/auth/customer'))
    return callers.includes('authenticated') && ep.path.includes('/auth/') ? 'Public' : 'Customer';
  if (callers.includes('Platform Admin')) return 'Platform Admin';
  if (callers.includes('Authenticated')) return 'Authenticated (see Notes)';
  return callers || 'Authenticated';
}

function folderFor(ep) {
  const p = ep.path.replace(/^\/api\/v1/, '');
  const c = ep.controller || '';

  if (c === 'HealthController' || p.startsWith('/health')) return '25 - Health';
  if (c === 'MetricsController' || p === '/metrics') return '26 - Utilities';

  if (p.startsWith('/auth/customer')) return '00 - Authentication';
  if (p.startsWith('/auth')) return '00 - Authentication';
  if (p === '/platform-admin/login') return '00 - Authentication';

  if (p.startsWith('/platform-admin')) {
    if (p.includes('/subscription') || p.includes('/plans')) return '22 - Subscriptions';
    return '06 - Platform Administration API';
  }

  if (p.startsWith('/discovery')) return '07 - Discovery';
  if (p === '/cuisine-categories' || p === '/occasion-categories') return '07 - Discovery';

  if (p.startsWith('/users/me')) return '02 - Customer API';
  if (p.startsWith('/notifications')) return '23 - Notifications';

  if (p.startsWith('/organizations/subscription')) return '21 - Organizations';
  if (p.startsWith('/organization/analytics')) return '14 - Analytics';

  if (p.includes('/analytics')) return '14 - Analytics';
  if (p.includes('/menus') || c.startsWith('Menu')) return '12 - Menu';
  if (p.includes('/offers') && !p.includes('/discovery')) return '11 - Offers';
  if (p.includes('/employees')) return '19 - Employees';
  if (p.includes('/floor-plans') || p.includes('/floor-plan')) return '17 - Floor Plans';
  if (p.includes('/tables') || c === 'TableController' || c === 'TablesController') return '18 - Tables';
  if (p.includes('/branches') && !p.includes('/discovery') && !p.includes('/analytics')) return '16 - Branches';
  if (p.startsWith('/restaurants') && (c === 'RestaurantsController' || /\/restaurants\/:id(\/|$)/.test(p) || p === '/restaurants'))
    return '15 - Restaurants';
  // restaurant conversations
  if (p.includes('/conversations') || c.includes('Conversation')) return '13 - Messaging';

  if (p.startsWith('/reservations') || c === 'ReservationsController') return '08 - Reservations';
  if (p.startsWith('/waitlist')) return '09 - Waitlist';
  if (p.includes('/reviews') || c === 'ReviewsController') return '10 - Reviews';

  // fallback restaurants
  if (p.startsWith('/restaurants')) return '15 - Restaurants';

  return '26 - Utilities';
}

function requestName(ep) {
  if (ep.apiOperation) {
    // Shorten common patterns
    let s = ep.apiOperation;
    s = s.replace(/\.$/, '');
    // Prefer concise CRUD names for known handlers
  }
  const handler = ep.handler;
  const p = ep.path.replace(/^\/api\/v1/, '');

  const map = {
    'POST /auth/login': 'Login',
    'POST /auth/refresh': 'Refresh Token',
    'POST /auth/forgot-password': 'Forgot Password',
    'POST /auth/reset-password': 'Reset Password',
    'POST /auth/change-password': 'Change Password',
    'POST /auth/logout': 'Logout Current Session',
    'POST /auth/logout-all': 'Logout All Devices',
    'GET /auth/sessions': 'List Active Sessions',
    'DELETE /auth/sessions/:sessionId': 'Revoke Session',
    'POST /auth/customer/register/start': 'Register Customer - Start',
    'POST /auth/customer/register/resend': 'Register Customer - Resend OTP',
    'POST /auth/customer/register/verify': 'Register Customer - Verify OTP',
    'POST /auth/customer/register/complete': 'Register Customer - Complete',
    'POST /auth/customer/login': 'Login Customer',
    'POST /auth/customer/password-reset/start': 'Customer Password Reset - Start',
    'POST /auth/customer/password-reset/resend': 'Customer Password Reset - Resend',
    'POST /auth/customer/password-reset/verify': 'Customer Password Reset - Verify',
    'POST /auth/customer/password-reset/complete': 'Customer Password Reset - Complete',
    'POST /platform-admin/login': 'Login Platform Admin',
    'POST /platform-admin/restaurant-owners': 'Provision Restaurant Owner',
    'GET /health': 'Health Check',
    'GET /health/liveness': 'Liveness',
    'GET /health/readiness': 'Readiness',
    'GET /metrics': 'Prometheus Metrics',
  };

  const key = `${ep.method} ${p}`;
  if (map[key]) return map[key];

  // Pattern-based naming
  if (ep.multipart && /\/image$/.test(p) && ep.method === 'POST') {
    if (p.includes('/items/')) return 'Upload Item Image';
    if (p.includes('/categories/')) return 'Upload Category Image';
  }
  if (ep.multipart && /\/gallery$/.test(p)) return 'Upload Gallery Image';
  if (ep.multipart && /\/avatar$/.test(p)) return 'Upload Avatar';
  if (ep.multipart && /\/images$/.test(p)) return 'Upload Review Image';
  if (ep.multipart && /\/messages$/.test(p)) return 'Send Message';

  if (/\/activate$/.test(p) && ep.method === 'POST') {
    if (p.includes('floor-plans')) return 'Activate Floor Plan';
    if (p.includes('/menus/')) return 'Activate Menu';
  }
  if (/\/deactivate$/.test(p)) return 'Deactivate Menu';
  if (/\/set-default$/.test(p)) return 'Set Default Menu';
  if (/\/publish$/.test(p)) return 'Publish Offer';
  if (/\/feature$/.test(p)) return 'Feature Item';
  if (/\/unfeature$/.test(p)) return 'Unfeature Item';
  if (/\/reorder$/.test(p)) return p.includes('/items') ? 'Reorder Items' : 'Reorder Categories';
  if (/\/availability$/.test(p)) return 'Replace Item Availability Windows';
  if (/\/image$/.test(p) && ep.method === 'DELETE') {
    return p.includes('/items/') ? 'Remove Item Image' : 'Remove Category Image';
  }

  if (handler && handler !== 'unknown') {
    const nice = handler
      .replace(/([A-Z])/g, ' $1')
      .replace(/^./, (c) => c.toUpperCase())
      .trim();
    // Expand common verbs
    // handler already converted to spaced words above
  }

  // Resource-based fallback
  const resource =
    p.includes('/menus') && p.includes('/categories') && p.includes('/items') && p.includes('/add-ons')
      ? 'Add-On'
      : p.includes('/option-groups') && p.includes('/options')
        ? 'Option'
        : p.includes('/option-groups')
          ? 'Option Group'
          : p.includes('/add-ons')
            ? 'Add-On'
            : p.includes('/items')
              ? 'Menu Item'
              : p.includes('/categories')
                ? 'Category'
                : p.includes('/menus')
                  ? 'Menu'
                  : p.includes('/offers')
                    ? 'Offer'
                    : p.includes('/branches')
                      ? 'Branch'
                      : p.includes('/employees')
                        ? 'Employee'
                        : p.includes('/floor-plans')
                          ? 'Floor Plan'
                          : p.includes('/tables')
                            ? 'Table'
                            : p.includes('/restaurants') && !p.includes('/discovery')
                              ? 'Restaurant'
                              : p.includes('/reservations')
                                ? 'Reservation'
                                : p.includes('/reviews')
                                  ? 'Review'
                                  : p.includes('/waitlist')
                                    ? 'Waitlist Entry'
                                    : p.includes('/conversations')
                                      ? 'Conversation'
                                      : p.includes('/notifications')
                                        ? 'Notification'
                                        : 'Resource';

  if (ep.method === 'POST' && !p.split('/').pop().startsWith(':') && !/-/.test(p.split('/').pop())) {
    const last = p.split('/').pop();
    if (['approve', 'reject', 'cancel', 'reschedule', 'complete', 'promote', 'merge', 'split', 'move', 'read', 'close'].includes(last)) {
      return last.replace(/(^|\b\w)/g, (c) => c.toUpperCase()).replace(/-/g, ' ') + (resource !== 'Resource' ? ` ${resource}` : '');
    }
    if (last === 'no-show') return 'Mark No-Show';
    if (last === 'table-ready') return 'Mark Table Ready';
    if (last === 'status') return 'Change Table Status';
    if (last === 'role') return 'Assign Employee Role';
    if (last === 'reply') return 'Reply To Review';
  }

  const action =
    ep.method === 'POST'
      ? 'Create'
      : ep.method === 'GET' && p.split('/').pop().startsWith(':')
        ? 'Get'
        : ep.method === 'GET'
          ? 'List'
          : ep.method === 'PATCH'
            ? 'Update'
            : ep.method === 'DELETE'
              ? 'Delete'
              : ep.method;

  // Special GETs
  if (ep.method === 'GET') {
    if (p.endsWith('/default')) return 'Get Default Menu';
    if (p.endsWith('/working-hours')) return `Get ${resource} Working Hours`;
    if (p.endsWith('/settings')) return 'Get Restaurant Settings';
    if (p.endsWith('/gallery')) return 'List Gallery';
    if (p.endsWith('/unread-count')) return 'Get Unread Count';
    if (p.endsWith('/identity-token')) return 'Get OneSignal Identity Token';
    if (p.endsWith('/availability')) return 'Search Availability';
    if (p.endsWith('/preferences')) return 'Get Preferences';
    if (p.endsWith('/favorites')) return 'List Favorites';
    if (p.endsWith('/usage')) return 'Get Subscription Usage';
    if (p.endsWith('/plans')) return 'List Plans';
    if (p.endsWith('/subscription')) return 'Get Subscription';
    if (p.includes('/peak-hours')) return 'Get Peak Hours';
    if (p.includes('/trends')) return 'Get Reservation Trends';
    if (p.includes('/reviews-summary')) return 'Get Reviews Summary';
    if (p.includes('/analytics/customers')) return 'Get Customer Insights';
    if (p.includes('/analytics/waitlist')) return 'Get Waitlist Analytics';
    if (p.includes('/reservations/summary')) return 'Get Reservations Summary';
    if (p.endsWith('/nearby')) return 'Search Nearby Restaurants';
    if (p.endsWith('/messages')) return 'List Messages';
    if (p.includes('/cuisine-categories') && p.includes('/restaurants/')) return 'Get Restaurant Cuisine Categories';
    if (p.includes('/occasion-categories') && p.includes('/restaurants/')) return 'Get Restaurant Occasion Categories';
    if (p === '/cuisine-categories') return 'List Cuisine Categories';
    if (p === '/occasion-categories') return 'List Occasion Categories';
    if (p.endsWith('/me')) return 'Get Current Profile';
    if (p.includes('/discovery/restaurants/') && p.split('/').length > 4) {
      /* fallthrough */
    }
  }

  if (ep.method === 'PATCH') {
    if (p.endsWith('/working-hours')) return `Update ${resource} Working Hours`;
    if (p.endsWith('/settings')) return 'Update Restaurant Settings';
    if (p.endsWith('/preferences')) return 'Update Preferences';
    if (p.endsWith('/cuisine-categories')) return 'Set Restaurant Cuisine Categories';
    if (p.endsWith('/occasion-categories')) return 'Set Restaurant Occasion Categories';
    if (p.endsWith('/read')) return 'Mark Notification Read';
    if (p.endsWith('/read-all')) return 'Mark All Notifications Read';
  }

  if (ep.method === 'POST') {
    if (p.endsWith('/compare')) return 'Compare Restaurants';
    if (p.endsWith('/favorites/:restaurantId'.replace(':restaurantId', p.includes('favorites') ? p.split('/').pop() : ''))) {
      /* */
    }
    if (p.includes('/favorites/')) return 'Add Favorite';
    if (p.endsWith('/branches') && p.includes('/employees/')) return 'Assign Employee Branch';
  }

  if (ep.method === 'DELETE' && p.includes('/favorites/')) return 'Remove Favorite';
  if (ep.method === 'DELETE' && p.includes('/gallery/')) return 'Remove Gallery Image';
  if (ep.method === 'DELETE' && p.includes('/images/')) return 'Remove Review Image';
  if (ep.method === 'DELETE' && p.includes('/employees/') && p.includes('/branches/')) return 'Remove Employee Branch';

  if (ep.apiOperation && ep.apiOperation.length < 60) return ep.apiOperation.replace(/\.$/, '');

  return `${action} ${resource}`.replace(/\s+/g, ' ').trim();
}

function sortOrder(name, method) {
  const n = name.toLowerCase();
  // Explicit auth flows
  if (n === 'login') return 1;
  if (n === 'login customer') return 2;
  if (n === 'login platform admin') return 3;
  if (n === 'refresh token' || n === 'refresh session') return 4;
  if (n.startsWith('register customer - start')) return 5;
  if (n.startsWith('register customer - resend')) return 6;
  if (n.startsWith('register customer - verify')) return 7;
  if (n.startsWith('register customer - complete')) return 8;
  if (n.startsWith('customer password reset - start')) return 9;
  if (n.startsWith('customer password reset - resend')) return 9.1;
  if (n.startsWith('customer password reset - verify')) return 9.2;
  if (n.startsWith('customer password reset - complete')) return 9.3;
  if (n.startsWith('forgot')) return 9.4;
  if (n.startsWith('reset password')) return 9.5;
  if (n.startsWith('create') || (method === 'POST' && n.startsWith('register'))) return 10;
  if (n.startsWith('list') || n.startsWith('search') || n.startsWith('compare')) return 20;
  if (n.startsWith('get')) return 30;
  if (n.startsWith('update') || n.startsWith('set ') || n.startsWith('replace') || n.startsWith('change')) return 40;
  if (
    /activate|deactivate|publish|feature|unfeature|approve|reject|cancel|reschedule|complete|promote|merge|split|move|mark |upload|remove |reply|assign|reorder|send |close|read |logout|provision|suspend|reactivate/.test(
      n,
    )
  )
    return 50;
  if (n.startsWith('delete') || n.startsWith('revoke') || n.startsWith('remove')) return 90;
  return 55;
}

function buildDescription(ep, name) {
  const role = roleLabel(ep);
  const guards = Object.entries(ep.guards || {})
    .filter(([, v]) => v)
    .map(([k]) => k);
  const pathParams = (ep.pathParams || []).map((p) => {
    let v = paramToVar(p);
    if (v === null) v = inferIdVar(ep);
    if (p === 'id') {
      if (ep.path.includes('/reservations/')) v = 'reservationId';
      else if (ep.path.includes('/reviews/')) v = 'reviewId';
      else if (ep.path.includes('/waitlist/')) v = 'waitlistEntryId';
      else if (ep.path.includes('/conversations/')) v = 'conversationId';
      else if (ep.path.includes('/notifications/')) v = 'notificationId';
      else if (ep.path.includes('/organizations/')) v = 'organizationId';
      else if (ep.path.includes('/restaurants/')) v = 'restaurantId';
    }
    return `| \`${p}\` | \`{{${v}}}\` | UUID path parameter |`;
  });

  const queryLines = [];
  if (ep.queryDto) queryLines.push(`Query DTO: \`${ep.queryDto}\` (see schema / examples in query params).`);
  if (ep.queryParams && ep.queryParams.length) {
    for (const q of ep.queryParams) queryLines.push(`- \`${q}\``);
  }

  const errors =
    (ep.apiErrors || [])
      .map((e) => {
        if (typeof e === 'string') return `- ${e}`;
        if (e && e.status) return `- **${e.status}**: ${(e.codes || []).join(', ') || e.description || ''}`;
        return `- ${JSON.stringify(e)}`;
      })
      .join('\n') || '- Standard auth/validation errors as applicable.';

  const authLine = ep.isPublic
    ? 'None (public — auth disabled on this request).'
    : ep.guards?.PlatformAdminGuard
      ? 'Bearer `{{platformAdminAccessToken}}` (Platform Admin issuer).'
      : role.includes('Customer') && !role.includes('Owner') && !role.includes('Employee')
        ? 'Bearer `{{customerAccessToken}}` (or `{{accessToken}}` if dual-actor).'
        : 'Bearer `{{accessToken}}`.';

  return [
    `## Purpose`,
    ep.apiOperation || ep.responseMessage || name,
    '',
    `## Authorization`,
    authLine,
    guards.length ? `Guards: ${guards.join(', ')}` : 'Guards: (none)',
    '',
    `## Required Role`,
    role,
    ep.requirePermissions ? `Permission: \`${ep.requirePermissions}\`` : '',
    ep.requireOrgRole ? `Org roles: ${JSON.stringify(ep.requireOrgRole)}` : '',
    '',
    `## Headers`,
    ep.isPublic ? '- (no Authorization header)' : '- `Authorization: Bearer <token>`',
    ep.multipart ? '- `Content-Type: multipart/form-data`' : '- `Content-Type: application/json` (when body present)',
    '',
    `## Path Params`,
    pathParams.length ? `| Name | Variable | Notes |\n|------|----------|-------|\n${pathParams.join('\n')}` : '_None_',
    '',
    `## Query Params`,
    queryLines.length ? queryLines.join('\n') : '_None_',
    '',
    `## Body`,
    ep.multipart
      ? 'Multipart form-data (see body form fields).'
      : ep.bodyDto
        ? `JSON body — DTO: \`${ep.bodyDto}\``
        : '_None_',
    '',
    `## Success Response`,
    ep.responseMessage
      ? `Envelope message: "${ep.responseMessage}"`
      : 'Standard success envelope `{ success, message, data, meta }` (or 204 No Content / raw health/metrics).',
    '',
    `## Error Responses`,
    errors,
    '',
    `## Notes`,
    `- Controller: \`${ep.controller}\`.\`${ep.handler}\``,
    `- Full path: \`${ep.path}\``,
    `- Callers (from source): ${Array.isArray(ep.caller) ? ep.caller.join('; ') : ep.caller}`,
    ep.methodComment ? `- ${ep.methodComment}` : '',
  ]
    .filter((line) => line !== '')
    .join('\n');
}

function buildBody(ep) {
  const key = normalizePathKey(ep.method, ep.path);
  const existing = existingBodies[key];

  if (ep.multipart) {
    if (ep.path.includes('/messages')) {
      return {
        mode: 'formdata',
        formdata: [
          { key: 'body', type: 'text', value: 'Hello — looking forward to our reservation.' },
          { key: 'attachment', type: 'file', src: [], description: 'Optional image/file attachment' },
        ],
      };
    }
    if (ep.path.includes('/gallery')) {
      return {
        mode: 'formdata',
        formdata: [
          { key: 'file', type: 'file', src: [], description: 'Image file (jpeg/png/webp)' },
          { key: 'caption', type: 'text', value: 'Dining room' },
          { key: 'sortOrder', type: 'text', value: '0' },
        ],
      };
    }
    // generic image upload
    return {
      mode: 'formdata',
      formdata: [{ key: 'file', type: 'file', src: [], description: 'Image file (jpeg/png/webp)' }],
    };
  }

  if (existing && existing.body) return existing.body;

  if (!ep.bodyDto) return undefined;

  let example = dtoExamples[ep.bodyDto];
  if (!example) {
    // minimal placeholders
    example = { note: `Fill fields for ${ep.bodyDto}` };
  }

  // Prefer collection variables in known auth DTOs
  const rawObj = { ...example };
  if (ep.bodyDto === 'LoginRequestDto') {
    return {
      mode: 'raw',
      raw: JSON.stringify(
        {
          email: '{{ownerEmail}}',
          password: '{{ownerPassword}}',
          deviceName: 'Postman Desktop',
          deviceType: 'web',
        },
        null,
        2,
      ),
      options: { raw: { language: 'json' } },
    };
  }
  if (ep.bodyDto === 'RefreshSessionRequestDto') {
    return {
      mode: 'raw',
      raw: JSON.stringify({ refreshToken: '{{refreshToken}}' }, null, 2),
      options: { raw: { language: 'json' } },
    };
  }
  if (ep.bodyDto === 'CustomerLoginRequestDto') {
    return {
      mode: 'raw',
      raw: JSON.stringify(
        {
          countryCode: '{{customerCountryCode}}',
          phoneNumber: '{{customerPhoneNumber}}',
          password: '{{customerPassword}}',
          deviceName: 'Postman iOS',
          deviceType: 'mobile',
        },
        null,
        2,
      ),
      options: { raw: { language: 'json' } },
    };
  }

  // Replace uuid-looking examples with variables when field names match
  const replaced = JSON.stringify(rawObj, null, 2).replace(
    /"[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}"/gi,
    `"${EXAMPLE_UUID}"`,
  );

  return {
    mode: 'raw',
    raw: replaced,
    options: { raw: { language: 'json' } },
  };
}

function buildAuth(ep) {
  if (ep.isPublic) return { type: 'noauth' };
  if (ep.guards?.PlatformAdminGuard || (ep.path.startsWith('/api/v1/platform-admin') && ep.path !== '/api/v1/platform-admin/login')) {
    return {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{platformAdminAccessToken}}', type: 'string' }],
    };
  }
  // Customer-primary surfaces
  const p = ep.path;
  if (
    p.includes('/users/me') ||
    p.includes('/notifications') ||
    (p.includes('/conversations') && !p.includes('/restaurants/')) ||
    (p.startsWith('/api/v1/reservations') && ['listMine', 'getMine'].includes(ep.handler)) ||
    (p.startsWith('/api/v1/reviews') && ['submit', 'listMine', 'addImage', 'deleteImage'].includes(ep.handler))
  ) {
    return {
      type: 'bearer',
      bearer: [{ key: 'token', value: '{{customerAccessToken}}', type: 'string' }],
    };
  }
  // Inherit collection bearer {{accessToken}}
  return undefined;
}

function buildQuery(ep) {
  if (!ep.queryDto && !(ep.queryParams && ep.queryParams.length)) return undefined;

  // Common pagination examples
  const params = [];
  if (ep.queryDto) {
    if (/List|Search|Nearby|Cursor|Analytics|Availability/i.test(ep.queryDto)) {
      params.push(
        { key: 'page', value: '1', description: 'Page number (1-based)', disabled: !/List|Search/.test(ep.queryDto) },
        { key: 'pageSize', value: '20', description: 'Page size', disabled: !/List|Search/.test(ep.queryDto) },
        { key: 'limit', value: '20', description: 'Cursor page size', disabled: !/Cursor/.test(ep.queryDto) },
        { key: 'cursor', value: '', description: 'Opaque cursor', disabled: true },
      );
    }
    if (/Nearby|SearchRestaurants/i.test(ep.queryDto)) {
      params.push(
        { key: 'lat', value: '33.5138', description: 'Latitude' },
        { key: 'lng', value: '36.2765', description: 'Longitude' },
        { key: 'radiusKm', value: '5', description: 'Search radius km', disabled: true },
        { key: 'q', value: '', description: 'Free-text query', disabled: true },
      );
    }
    if (/Analytics|DateRange/i.test(ep.queryDto)) {
      params.push(
        { key: 'from', value: '2026-01-01', description: 'ISO date start' },
        { key: 'to', value: '2026-01-31', description: 'ISO date end' },
        { key: 'branchId', value: '{{branchId}}', description: 'Optional branch filter', disabled: true },
      );
    }
    if (/Availability/i.test(ep.queryDto)) {
      params.push(
        { key: 'restaurantId', value: '{{restaurantId}}' },
        { key: 'branchId', value: '{{branchId}}' },
        { key: 'date', value: '2026-08-15' },
        { key: 'partySize', value: '2' },
      );
    }
  }
  if (ep.queryParams) {
    for (const q of ep.queryParams) {
      if (!params.find((x) => x.key === q)) params.push({ key: q, value: '', disabled: true });
    }
  }
  // Deduplicate by key keeping first
  const seen = new Set();
  return params.filter((p) => {
    if (seen.has(p.key)) return false;
    seen.add(p.key);
    return true;
  });
}

function buildEvents(ep, name) {
  const key = normalizePathKey(ep.method, ep.path);
  const existing = existingBodies[key];
  if (existing && existing.event) return existing.event;

  const scripts = [];

  // Auto-capture scripts for create endpoints
  if (ep.method === 'POST' && !ep.isPublic) {
    const captures = [];
    if (name === 'Create Restaurant' || ep.handler === 'create' && ep.controller === 'RestaurantsController') {
      captures.push(
        "if (d.id) pm.collectionVariables.set('restaurantId', d.id);",
        "if (d.restaurantId) pm.collectionVariables.set('restaurantId', d.restaurantId);",
        "if (d.slug) pm.collectionVariables.set('restaurantSlug', d.slug);",
      );
    }
    if (ep.controller === 'BranchesController' && ep.handler === 'create') {
      captures.push(
        "if (d.id) pm.collectionVariables.set('branchId', d.id);",
        "if (d.branchId) pm.collectionVariables.set('branchId', d.branchId);",
      );
    }
    if (ep.controller === 'MenusController' && ep.handler === 'create') {
      captures.push("if (d.id) pm.collectionVariables.set('menuId', d.id);", "if (d.menuId) pm.collectionVariables.set('menuId', d.menuId);");
    }
    if (ep.controller === 'MenuCategoriesController' && (ep.handler === 'create' || name === 'Create Category')) {
      captures.push(
        "if (d.id) pm.collectionVariables.set('categoryId', d.id);",
        "if (d.categoryId) pm.collectionVariables.set('categoryId', d.categoryId);",
      );
    }
    if (ep.controller === 'MenuItemsController' && ep.handler === 'create') {
      captures.push("if (d.id) pm.collectionVariables.set('itemId', d.id);", "if (d.itemId) pm.collectionVariables.set('itemId', d.itemId);");
    }
    if (ep.controller === 'OffersController' && ep.handler === 'create') {
      captures.push("if (d.id) pm.collectionVariables.set('offerId', d.id);", "if (d.offerId) pm.collectionVariables.set('offerId', d.offerId);");
    }
    if (ep.controller === 'ReservationsController' && ep.handler === 'create') {
      captures.push(
        "if (d.id) pm.collectionVariables.set('reservationId', d.id);",
        "if (d.reservationId) pm.collectionVariables.set('reservationId', d.reservationId);",
      );
    }
    if (ep.controller === 'ConversationsController' && ep.handler === 'start') {
      captures.push(
        "if (d.id) pm.collectionVariables.set('conversationId', d.id);",
        "if (d.conversationId) pm.collectionVariables.set('conversationId', d.conversationId);",
      );
    }
    if (ep.controller === 'FloorPlansController' && ep.handler === 'create') {
      captures.push(
        "if (d.id) pm.collectionVariables.set('floorPlanId', d.id);",
        "if (d.floorPlanId) pm.collectionVariables.set('floorPlanId', d.floorPlanId);",
      );
    }
    if (ep.controller === 'TablesController' && ep.handler === 'create') {
      captures.push("if (d.id) pm.collectionVariables.set('tableId', d.id);", "if (d.tableId) pm.collectionVariables.set('tableId', d.tableId);");
    }
    if (ep.controller === 'EmployeesController' && ep.handler === 'invite') {
      captures.push(
        "if (d.id) pm.collectionVariables.set('employeeId', d.id);",
        "if (d.employeeId) pm.collectionVariables.set('employeeId', d.employeeId);",
        "if (d.roleId) pm.collectionVariables.set('roleId', d.roleId);",
      );
    }
    if (ep.path.includes('platform-admin/login') || (ep.controller === 'PlatformAdminController' && ep.handler === 'login')) {
      captures.push(
        "if (d.accessToken) pm.collectionVariables.set('platformAdminAccessToken', d.accessToken);",
        "pm.environment.set('platformAdminAccessToken', d.accessToken);",
      );
    }

    if (captures.length) {
      scripts.push({
        listen: 'test',
        script: {
          type: 'text/javascript',
          exec: [
            `pm.test('${name} succeeded', function () { pm.expect(pm.response.code).to.be.oneOf([200, 201]); });`,
            'const jsonData = pm.response.json();',
            'if (jsonData && jsonData.data) {',
            '  const d = jsonData.data;',
            ...captures.map((c) => '  ' + c),
            '}',
          ],
        },
      });
    }
  }

  // Login captures (staff)
  if (ep.path === '/api/v1/auth/login') {
    scripts.push({
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          "pm.test('Login succeeded (200)', function () { pm.response.to.have.status(200); });",
          'const jsonData = pm.response.json();',
          'if (jsonData && jsonData.data) {',
          '  const d = jsonData.data;',
          "  pm.collectionVariables.set('accessToken', d.accessToken);",
          "  pm.collectionVariables.set('refreshToken', d.refreshToken);",
          "  pm.collectionVariables.set('sessionId', d.sessionId);",
          "  pm.collectionVariables.set('sessionVersion', String(d.sessionVersion));",
          "  if (d.user) { pm.collectionVariables.set('userId', d.user.userId); }",
          '  if (d.organization) {',
          "    pm.collectionVariables.set('organizationId', d.organization.organizationId);",
          "    pm.collectionVariables.set('organizationSlug', d.organization.slug);",
          '  }',
          '}',
        ],
      },
    });
  }

  if (ep.path === '/api/v1/auth/customer/login') {
    scripts.push({
      listen: 'test',
      script: {
        type: 'text/javascript',
        exec: [
          "pm.test('Customer login succeeded (200)', function () { pm.response.to.have.status(200); });",
          'const jsonData = pm.response.json();',
          'if (jsonData && jsonData.data) {',
          '  const d = jsonData.data;',
          "  pm.collectionVariables.set('customerAccessToken', d.accessToken);",
          "  pm.collectionVariables.set('customerRefreshToken', d.refreshToken);",
          "  pm.collectionVariables.set('customerSessionId', d.sessionId);",
          "  if (d.user) { pm.collectionVariables.set('customerUserId', d.user.userId); }",
          '}',
        ],
      },
    });
  }

  return scripts.length ? scripts : undefined;
}

// Flatten endpoints
const endpoints = [];
for (const c of inventory.controllers) {
  for (const e of c.endpoints) {
    endpoints.push({
      ...e,
      controller: c.name || c.className || c.controller || e.controller,
    });
  }
}

console.log('Building collection for', endpoints.length, 'endpoints');
console.log('DTO examples loaded:', Object.keys(dtoExamples).length);

const FOLDER_META = {
  '00 - Authentication': 'Owner/Employee auth, Customer auth, and Platform Admin login. Public endpoints use noauth.',
  '01 - Public Mobile API':
    'Reserved for mobile-oriented public aggregates. Discovery & taxonomy live under 07 - Discovery; public menu/review reads live under their capability folders.',
  '02 - Customer API': 'Authenticated customer profile, preferences, avatar, and favorites (`/users/me/*`).',
  '03 - Restaurant Dashboard API':
    'Cross-cutting restaurant operations are filed under capability folders 11–19 and 15–18. Use Owner/Admin token `{{accessToken}}`.',
  '04 - Employee API':
    'Employee-permission actions (approve/reject/complete/etc.) live under Reservations, Waitlist, Tables, Menu, Analytics, Messaging with Required Role documented per request.',
  '05 - Organization Owner/Admin API':
    'Organization-scoped reads (subscription usage, org analytics) live under 14 - Analytics and 21 - Organizations.',
  '06 - Platform Administration API': 'Platform Admin provisioning. Subscription admin routes live under 22 - Subscriptions.',
  '07 - Discovery': 'Public restaurant discovery & taxonomy (rate-limited).',
  '08 - Reservations': 'Customer and employee reservation lifecycle.',
  '09 - Waitlist': 'Join, cancel, and promote waitlist entries.',
  '10 - Reviews': 'Public reads, customer submit/images, owner reply.',
  '11 - Offers': 'Restaurant offer management (public browse via Discovery).',
  '12 - Menu': 'Phase 18 menu management + public menu reads.',
  '13 - Messaging': 'Phase 15.6 conversations (customer + restaurant).',
  '14 - Analytics': 'Restaurant and organization analytics.',
  '15 - Restaurants': 'Restaurant CRUD, settings, hours, gallery, taxonomy assignment.',
  '16 - Branches': 'Branch CRUD and working hours.',
  '17 - Floor Plans': 'Floor plan create/list/activate and tables-on-plan.',
  '18 - Tables': 'Table CRUD, merge/split/move/status.',
  '19 - Employees': 'Invite, role, and branch assignment.',
  '20 - Roles & Permissions':
    'No dedicated Roles HTTP controller. Roles are assigned via Employees > Assign Employee Role. Permissions are enforced via `@RequirePermission` on routes.',
  '21 - Organizations': 'Organization subscription status and usage (Owner/Admin).',
  '22 - Subscriptions': 'Platform Admin plan catalog and organization subscription lifecycle.',
  '23 - Notifications': 'In-app notification inbox and OneSignal identity token.',
  '24 - File Uploads':
    'Multipart uploads are kept with their parent resources (Restaurants gallery, Users avatar, Reviews images, Menu images, Messaging attachments) so each endpoint appears exactly once.',
  '25 - Health': 'Infrastructure health checks (envelope skipped). Paths are versioned: `/api/v1/health` (Nest defaultVersion).',
  '26 - Utilities': 'Prometheus metrics and miscellaneous utilities.',
};

const folderOrder = Object.keys(FOLDER_META);

const folders = {};
for (const f of folderOrder) {
  folders[f] = [];
}

const usedNames = new Map(); // folder -> Set of names
const built = [];

for (const ep of endpoints) {
  const folder = folderFor(ep);
  const name = requestName(ep);
  if (!usedNames.has(folder)) usedNames.set(folder, new Set());
  let finalName = name;
  if (usedNames.get(folder).has(finalName)) {
    finalName = `${name} (${ep.method})`;
    let i = 2;
    while (usedNames.get(folder).has(finalName)) {
      finalName = `${name} (${i++})`;
    }
  }
  usedNames.get(folder).add(finalName);

  const relPath = collectionRelativePath(ep.path);
  const segments = resolvePathSegments(ep);
  const query = buildQuery(ep);
  const body = buildBody(ep);
  const auth = buildAuth(ep);
  const key = normalizePathKey(ep.method, ep.path);
  const id = uuidFromKey(key);

  const url = {
    raw:
      '{{baseUrl}}/' +
      segments.join('/') +
      (query && query.some((q) => !q.disabled)
        ? '?' +
          query
            .filter((q) => !q.disabled)
            .map((q) => `${q.key}=${encodeURIComponent(q.value)}`)
            .join('&')
        : ''),
    host: ['{{baseUrl}}'],
    path: segments,
  };
  if (query && query.length) url.query = query;

  const headers = [];
  if (body && body.mode === 'raw') {
    headers.push({ key: 'Content-Type', value: 'application/json' });
  }

  const request = {
    method: ep.method,
    header: headers,
    url,
    description: buildDescription(ep, finalName),
  };
  if (auth) request.auth = auth;
  if (body) request.body = body;

  const item = {
    name: finalName,
    id,
    request,
    response: [],
  };

  const events = buildEvents(ep, finalName);
  if (events) item.event = events;

  // Role badge in name prefix? User asked for clear indication - put in description Required Role.
  // Also add to name as suffix for scanning: [Public]
  const role = roleLabel(ep);
  item.name = finalName; // keep clean names; role in docs

  folders[folder].push({ item, sort: sortOrder(finalName, ep.method), ep, key });
  built.push({ folder, name: finalName, method: ep.method, path: ep.path, key, role });
}

// Sort within folders
for (const f of folderOrder) {
  folders[f].sort((a, b) => a.sort - b.sort || a.item.name.localeCompare(b.item.name));
}

const collectionItems = folderOrder.map((f) => ({
  name: f,
  description: FOLDER_META[f],
  item: folders[f].map((x) => x.item),
}));

// Defensive re-sort on final items (ensures Create → List → Get → Update → Actions → Delete)
for (const folder of collectionItems) {
  folder.item.sort(
    (a, b) =>
      sortOrder(a.name, a.request.method) - sortOrder(b.name, b.request.method) ||
      a.name.localeCompare(b.name),
  );
}

const collectionVariables = [
  { key: 'baseUrl', value: 'http://187.127.76.76:3000/api/v1' },
  { key: 'accessToken', value: '' },
  { key: 'refreshToken', value: '' },
  { key: 'customerAccessToken', value: '' },
  { key: 'customerRefreshToken', value: '' },
  { key: 'platformAdminAccessToken', value: '' },
  { key: 'sessionId', value: '' },
  { key: 'otherSessionId', value: '' },
  { key: 'sessionVersion', value: '' },
  { key: 'resetToken', value: '' },
  { key: 'userId', value: '' },
  { key: 'customerUserId', value: '' },
  { key: 'organizationId', value: '' },
  { key: 'organizationSlug', value: '' },
  { key: 'restaurantId', value: '' },
  { key: 'restaurantSlug', value: '' },
  { key: 'branchId', value: '' },
  { key: 'floorPlanId', value: '' },
  { key: 'tableId', value: '' },
  { key: 'employeeId', value: '' },
  { key: 'roleId', value: '' },
  { key: 'menuId', value: '' },
  { key: 'categoryId', value: '' },
  { key: 'itemId', value: '' },
  { key: 'addOnId', value: '' },
  { key: 'optionGroupId', value: '' },
  { key: 'optionId', value: '' },
  { key: 'offerId', value: '' },
  { key: 'reservationId', value: '' },
  { key: 'waitlistEntryId', value: '' },
  { key: 'reviewId', value: '' },
  { key: 'reviewImageId', value: '' },
  { key: 'conversationId', value: '' },
  { key: 'notificationId', value: '' },
  { key: 'galleryItemId', value: '' },
  { key: 'cuisineCategoryId', value: '' },
  { key: 'occasionCategoryId', value: '' },
  { key: 'customerOtp', value: '' },
  { key: 'ownerEmail', value: 'owner@example.com' },
  { key: 'ownerPassword', value: 'SecurePass123!' },
  { key: 'customerCountryCode', value: 'SY' },
  { key: 'customerPhoneNumber', value: '0912345678' },
  { key: 'customerPassword', value: 'SecurePass123!' },
  { key: 'customerNewPassword', value: 'BrandNewPass1!' },
  { key: 'customerUsername', value: 'jane_doe' },
  { key: 'platformAdminEmail', value: 'admin@tavla.internal' },
  { key: 'platformAdminPassword', value: '' },
  { key: 'newOwnerEmail', value: 'owner@example.com' },
  { key: 'newOwnerPassword', value: 'SecurePass123!' },
  { key: 'newOrganizationName', value: 'Acme Restaurant Group' },
];

const collection = {
  info: {
    _postman_id: oldCollection.info._postman_id || uuidFromKey('tavla-api-collection'),
    name: 'TAVLA API',
    description: [
      'Enterprise Restaurant Reservation Platform — REST API (v1).',
      '',
      '**Source of truth**: NestJS controllers under `apps/backend/src` (rebuilt by audit).',
      '',
      '**Base URL**: `{{baseUrl}}` → `…/api/v1`',
      '',
      '**Response envelope** (business endpoints unless noted):',
      '```json',
      '{ "success": true, "message": "...", "data": {}, "meta": {} }',
      '```',
      '',
      '**Auth**: Collection Bearer uses `{{accessToken}}`. Public requests set `noauth`.',
      'Platform Admin routes use `{{platformAdminAccessToken}}`. Customer-primary routes use `{{customerAccessToken}}`.',
      '',
      '**Role labels** are documented on every request under **Required Role**.',
      '',
      'Endpoints are grouped by business capability. Each backend route appears **exactly once**.',
    ].join('\n'),
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  },
  variable: collectionVariables,
  item: collectionItems,
};

// Environment
const envKeys = [
  ['baseUrl', 'http://187.127.76.76:3000/api/v1', 'default'],
  ['ownerEmail', 'owner@example.com', 'default'],
  ['ownerPassword', 'SecurePass123!', 'secret'],
  ['accessToken', '', 'secret'],
  ['refreshToken', '', 'secret'],
  ['sessionId', '', 'default'],
  ['sessionVersion', '', 'default'],
  ['otherSessionId', '', 'default'],
  ['resetToken', '', 'secret'],
  ['userId', '', 'default'],
  ['organizationId', '', 'default'],
  ['organizationSlug', '', 'default'],
  ['restaurantId', '', 'default'],
  ['restaurantSlug', '', 'default'],
  ['branchId', '', 'default'],
  ['floorPlanId', '', 'default'],
  ['tableId', '', 'default'],
  ['employeeId', '', 'default'],
  ['roleId', '', 'default'],
  ['menuId', '', 'default'],
  ['categoryId', '', 'default'],
  ['itemId', '', 'default'],
  ['addOnId', '', 'default'],
  ['optionGroupId', '', 'default'],
  ['optionId', '', 'default'],
  ['offerId', '', 'default'],
  ['reservationId', '', 'default'],
  ['waitlistEntryId', '', 'default'],
  ['reviewId', '', 'default'],
  ['reviewImageId', '', 'default'],
  ['conversationId', '', 'default'],
  ['notificationId', '', 'default'],
  ['galleryItemId', '', 'default'],
  ['cuisineCategoryId', '', 'default'],
  ['occasionCategoryId', '', 'default'],
  ['customerUsername', 'jane_doe', 'default'],
  ['customerCountryCode', 'SY', 'default'],
  ['customerPhoneNumber', '0912345678', 'default'],
  ['customerPassword', 'SecurePass123!', 'secret'],
  ['customerNewPassword', 'BrandNewPass1!', 'secret'],
  ['customerOtp', '', 'secret'],
  ['customerUserId', '', 'default'],
  ['customerAccessToken', '', 'secret'],
  ['customerRefreshToken', '', 'secret'],
  ['customerSessionId', '', 'default'],
  ['platformAdminEmail', 'admin@tavla.internal', 'default'],
  ['platformAdminPassword', '', 'secret'],
  ['platformAdminAccessToken', '', 'secret'],
  ['newOwnerEmail', 'owner@example.com', 'default'],
  ['newOwnerPassword', 'SecurePass123!', 'secret'],
  ['newOrganizationName', 'Acme Restaurant Group', 'default'],
];

const environment = {
  id: oldEnv.id || uuidFromKey('tavla-api-env'),
  name: oldEnv.name || 'TAVLA API - Production (187.127.76.76)',
  values: envKeys.map(([key, value, type]) => ({
    key,
    value: oldEnv.values?.find((v) => v.key === key)?.value ?? value,
    type,
    enabled: true,
  })),
  _postman_variable_scope: 'environment',
};

// Preserve passwords etc from old env when present
for (const v of environment.values) {
  const old = oldEnv.values?.find((x) => x.key === v.key);
  if (old && old.value !== undefined && old.value !== '') v.value = old.value;
}

fs.writeFileSync(path.join(ROOT, 'TAVLA-API.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(ROOT, 'TAVLA-API.postman_environment.json'), JSON.stringify(environment, null, 2));

// Verification
function walkCol(items, acc = []) {
  for (const it of items || []) {
    if (it.item) walkCol(it.item, acc);
    else if (it.request) {
      const r = it.request;
      let url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
      let p = url.replace(/\{\{baseUrl\}\}/g, '').split('?')[0];
      if (!p.startsWith('/')) p = '/' + p.replace(/^\//, '');
      // normalize vars back to :param
      p = p.replace(/\{\{[^}]+\}\}/g, ':param');
      acc.push({ name: it.name, method: r.method, path: p, key: normalizePathKey(r.method, '/api/v1' + p) });
    }
  }
  return acc;
}

const colReqs = walkCol(collection.item);
const backendKeys = new Map();
for (const ep of endpoints) {
  const k = normalizePathKey(ep.method, ep.path);
  if (!backendKeys.has(k)) backendKeys.set(k, []);
  backendKeys.get(k).push(ep);
}
const colKeys = new Map();
for (const r of colReqs) {
  if (!colKeys.has(r.key)) colKeys.set(r.key, []);
  colKeys.get(r.key).push(r);
}

const missing = [...backendKeys.keys()].filter((k) => !colKeys.has(k));
const extra = [...colKeys.keys()].filter((k) => !backendKeys.has(k));
const dups = [...colKeys.entries()].filter(([, v]) => v.length > 1);

// Old collection comparison for report
function walkOld(items, acc = []) {
  for (const it of items || []) {
    if (it.item) walkOld(it.item, acc);
    else if (it.request) {
      const r = it.request;
      let url = typeof r.url === 'string' ? r.url : r.url?.raw || '';
      let p = url
        .replace(/\{\{baseUrl\}\}/g, '')
        .replace(/\{\{apiRoot\}\}/g, '')
        .split('?')[0];
      p = p.replace(/^\/api\/v1/, '').replace(/^\/api/, '');
      if (!p.startsWith('/')) p = '/' + p.replace(/^\//, '');
      acc.push({ method: r.method, path: p, key: normalizePathKey(r.method, '/api/v1' + p), name: it.name });
    }
  }
  return acc;
}
const oldReqs = walkOld(oldCollection.item).map((r) => ({
  ...r,
  // Treat leftover {{var}} segments from raw URLs as params for fair comparison
  key: normalizePathKey(r.method, '/api/v1' + r.path.replace(/\{\{[^}]+\}\}/g, ':param')),
}));
const oldKeys = new Set(oldReqs.map((r) => r.key));
const newKeys = new Set(colReqs.map((r) => r.key));
const added = [...newKeys].filter((k) => !oldKeys.has(k));
const removed = [...oldKeys].filter((k) => !newKeys.has(k));

// Corrected: health was on apiRoot (wrong) - now on baseUrl; count as corrected if path changed semantics
const corrected = [
  'GET /health (was {{apiRoot}}/health → now {{baseUrl}}/health = /api/v1/health per Nest defaultVersion)',
  'GET /health/liveness',
  'GET /health/readiness',
  'Removed obsolete apiRoot variable (all routes use baseUrl /api/v1)',
  'Deduplicated POST /reservations (Phone/Walk-In duplicate removed; single Create Reservation covers all channels)',
];

const hierarchy = folderOrder.map((f) => `  ${f} (${folders[f].length} requests)`).join('\n');

const report = `# Postman Collection Reconciliation Report

Generated: ${new Date().toISOString()}

## Source of truth
NestJS controllers under \`apps/backend/src\` (inventory: \`_endpoint_inventory.json\`).
Documentation, Swagger, README, and prior collections were **not** treated as authoritative.

## Discovery summary
| Metric | Count |
|--------|------:|
| Controllers discovered | ${inventory.controllers.length} |
| Endpoints discovered | ${endpoints.length} |
| Previous collection requests | ${oldReqs.length} |
| New collection requests | ${colReqs.length} |
| Endpoints added | ${added.length} |
| Endpoints removed | ${removed.length} |
| Endpoints corrected | ${corrected.length} |
| Duplicate requests removed | 1 (POST /reservations Phone/Walk-In twin) |
| Missing from new collection (must be 0) | **${missing.length}** |
| Extra in new collection (must be 0) | **${extra.length}** |
| Duplicate keys in new collection (must be 0) | **${dups.length}** |

## Endpoints added (present in backend, missing from old collection)
${added.map((k) => `- \`${k}\``).join('\n') || '_None_'}

## Endpoints removed (in old collection, not in backend)
${removed.map((k) => `- \`${k}\``).join('\n') || '_None_'}

## Corrections
${corrected.map((c) => `- ${c}`).join('\n')}

## Missing documentation fixed
- Every request now includes Purpose, Authorization, Required Role, Headers, Path/Query/Body, Success/Error, Notes.
- Role separation documented on every request.
- Menu (Phase 18), Messaging (Phase 15.6), Analytics, Offers, Subscriptions, multipart uploads included.
- Collection Bearer auth + per-request noauth / platform-admin / customer token overrides.
- Test scripts auto-capture IDs/JWTs on create/login where applicable.

## Final folder hierarchy
${hierarchy}

## Role categorization (request counts by Required Role label)
${Object.entries(
  built.reduce((acc, b) => {
    acc[b.role] = (acc[b.role] || 0) + 1;
    return acc;
  }, {}),
)
  .map(([k, v]) => `- ${k}: ${v}`)
  .join('\n')}

## Verification
\`\`\`
Backend endpoints:     ${endpoints.length}
Collection requests:   ${colReqs.length}
Missing from collection: ${missing.length}
Extra in collection:     ${extra.length}
Duplicates:              ${dups.length}
\`\`\`

${
  missing.length === 0 && extra.length === 0 && dups.length === 0
    ? '**PASS**: There are zero backend endpoints missing from the Postman Collection. Every endpoint exists exactly once.'
    : `**FAIL**\nMissing:\n${missing.map((m) => '- ' + m).join('\n')}\nExtra:\n${extra.map((m) => '- ' + m).join('\n')}\nDups:\n${dups.map(([k, v]) => '- ' + k + ' x' + v.length).join('\n')}`
}

## Outputs
1. \`apps/backend/postman/TAVLA-API.postman_collection.json\`
2. \`apps/backend/postman/TAVLA-API.postman_environment.json\`
3. \`apps/backend/postman/RECONCILIATION_REPORT.md\` (this file)
`;

fs.writeFileSync(path.join(ROOT, 'RECONCILIATION_REPORT.md'), report);

console.log(report);
if (missing.length || extra.length || dups.length) {
  console.error('VERIFICATION FAILED');
  process.exit(1);
}
console.log('VERIFICATION PASSED');
