# API GUIDELINES

## API Version

All endpoints must be versioned.

Example:

/api/v1

---

# Naming Convention

Use plural nouns.

Correct:

/restaurants

/reservations

/tables

/users

Incorrect:

/getRestaurants

/createReservation

---

# HTTP Methods

GET

Retrieve resources.

POST

Create resources.

PUT

Replace resources.

PATCH

Partial updates.

DELETE

Soft delete unless otherwise specified.

---

# Response Format

Successful Response

```json
{
  "success": true,
  "message": "Reservation created successfully.",
  "data": {},
  "meta": {}
}
```

Error Response

```json
{
  "success": false,
  "message": "Validation failed.",
  "code": "VALIDATION_ERROR",
  "errors": [],
  "timestamp": "",
  "path": ""
}
```

The `code` field carries the application error code from the Error Codes section below. It is always present on error responses, including generic HTTP failures (401/403/404) that are not yet tied to a domain-specific code.

---

# Pagination

Support:

page

limit

sort

order

Cursor pagination for large datasets.

**Messaging (Phase 15.6, DECISIONS.md D13):** `GET /conversations/:id/messages` and the two conversation-list endpoints use true cursor (keyset) pagination — `(createdAt, id)` — default page size 50, maximum 100. This is the first true cursor-paginated endpoint set in the API; every other list endpoint in this codebase still uses page/limit offset pagination, and that convention is unchanged elsewhere. Cursor pagination was chosen specifically because message history is an append-heavy, high-churn feed where offset pagination double-counts/skips rows under concurrent inserts.

---

# Bulk Reorder Endpoints

**Menu Management (Phase 18, architecture frozen 2026-08-02, ADR-031 — not implemented) introduces this as a new, reusable convention** — no prior module had a "reorder a bounded set of sibling rows" endpoint. Shape: `PATCH <parent-collection>/reorder`, body `{ orderedIds: string[] }` (a UUID array, `@IsUUID(4, { each: true })`, `@ArrayUnique()`, `@ArrayNotEmpty()`). Semantics are **whole-set replacement, not incremental**: `orderedIds` must exactly match the current non-deleted sibling set under the resolved parent (set equality, both directions) — a partial array, a foreign ID, or an ID belonging to a different parent is rejected with a validation error before any `displayOrder` value is written, not silently ignored. On success, every sibling's `displayOrder` is set to its index in `orderedIds`, in one transaction. First consumers: `PATCH /restaurants/:restaurantId/menus/:menuId/categories/reorder` (Categories within a Menu) and `PATCH /restaurants/:restaurantId/menus/:menuId/categories/:categoryId/items/reorder` (Items within a Category) — see `DOMAIN_MODEL.md`'s Menu Aggregate and `EVENTS.md`'s `CategoriesReordered`/`MenuItemsReordered`. **`:menuId` segment added by ADR-032** (2026-08-03): the original Phase 18 freeze assumed a singleton Menu per Restaurant (`.../menu/categories/reorder`, no id needed); ADR-032 supersedes that to Restaurant 1:N Menu, so every Menu-scoped route below the Restaurant must address a specific Menu explicitly. No live route existed under the old shape, so this is not a breaking change to anything implemented. Future modules needing ordered siblings under a shared parent should reuse this exact shape rather than inventing a new one.

**Menu Item Availability (added by ADR-032)** reuses this same whole-set-replacement convention for a different field shape: `PATCH /restaurants/:restaurantId/menus/:menuId/categories/:categoryId/items/:itemId/availability`, body `{ windows: Array<{ dayOfWeek: number; startTime: string; endTime: string }> }`, valid only while the Item's `availabilityMode = Scheduled`. Replaces the entire `MenuItemAvailability` row set for that Item in one transaction — see `EVENTS.md`'s `MenuItemAvailabilityWindowsReplaced`.

---

# Platform Back Office Route Ownership (Phase 19, architecture frozen 2026-08-04, ADR-033/034/035; Phase 19.1 subset implemented 2026-08-04)

All routes remain under the existing `/platform-admin` prefix, guarded by `PlatformAdminGuard` (or the two-tier `@RequirePlatformAdminRole` variant, ADR-034 §11-12), never a new top-level prefix. Ownership is mostly existing modules gaining new PlatformAdmin-facing controllers, not one new monolithic module:

| Route family | Owning module | Mechanism (ADR-035) | Status |
|---|---|---|---|
| `/platform-admin/restaurants/:id/{suspend,reactivate,delete,restore}` | Restaurants (new PlatformAdmin controller) | Pattern 1 (via an internal Pattern 2 resolve — `PrismaPlatformAdminRestaurantLookupReader`) | **Implemented** |
| `/platform-admin/organizations/:id/{suspend,reactivate,transfer-ownership}` | Organizations (module's first real use-case layer) | Pattern 1 | **Implemented** |
| `/platform-admin/organizations/:id/{delete,restore}` | Organizations | Pattern 1 | Not implemented — out of Phase 19.1 scope ("complete Organization Management") |
| `/platform-admin/accounts/:userId/{force-logout,reset-credentials,disable-login,enable-login}` | Authentication | Pattern 1 | **Implemented** |
| `/platform-admin/admins` (CRUD) | Platform Admin | Pattern 1 | **Implemented** (create/list/get/update-role/deactivate/reactivate — reactivate and role-update are implementation-scope additions beyond ADR-034 §10's literal text) |
| `/platform-admin/acquisitions*`, `/platform-admin/pricing*` | New `customer-acquisition` module (ADR-033) | Pattern 1 (mutation) | Not implemented |
| `/platform-admin/revenue*`, `/platform-admin/dashboard` | New `customer-acquisition` module (revenue) + Platform Admin module (dashboard composition) | Pattern 2 | Not implemented |
| `/platform-admin/audit-logs` | Platform Admin, reading via a new `AuditLogReaderPort` | Pattern 2 | Not implemented |
| `/platform-admin/search` | Platform Admin (thin composition delegating to each target module's own query ports — no new search infrastructure) | Pattern 1/2 per target | Not implemented |

`/organizations/subscription*` and `/platform-admin/organizations/:id/subscription*` (Subscriptions, ADR-027) are unaffected.

---

# Filtering

Example

GET /restaurants?city=Damascus&rating=5

**Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, complete/live-verified/production-verified 2026-07-30) frozen contract:** the actual filtering surface lives under `/discovery/restaurants`, not `/restaurants` (the latter remains Owner/Admin-only management CRUD - see "Customer Restaurant Discovery & Public Read Surface" below). `GET /discovery/restaurants` accepts `q` (name-only `ILIKE`), `cuisineId`, `occasionId`, `priceLevel`, `minRating`, `city`, `sort` (`name`|`rating`|`newest`), `order`, plus existing `page`/`limit`. `GET /discovery/restaurants/nearby` accepts `lat`, `lng`, `radiusKm` (default 5, max 50, kilometers) plus the same filters, sorted `distance ASC` only. `POST /discovery/restaurants/compare` accepts `{ restaurantIds: string[] }` (2-5 unique UUIDs). Full decision record: `TASKS.md`'s Phase 15.5 decision note (D1-D17) and `DECISIONS.md` ADR-018's own Phase 15.5 addendum.

---

# Sorting

Example

sort=createdAt

order=desc

---

# Validation

Every request must be validated.

Never trust client input.

---

# Authentication

Authorization: Bearer <token>

Refresh tokens must never be sent in URLs.

---

# Status Codes

200 OK

201 Created

204 No Content

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

422 Unprocessable Entity

429 Too Many Requests

500 Internal Server Error

---

# DTO Rules

Never expose database entities directly.

Always return Response DTOs.

---

# File Upload

Multipart only.

Validate:

* MIME type
* File size
* Extension

---

# API Documentation

Every endpoint must include:

Summary

Description

Parameters

Responses

Examples

Authentication requirements

Swagger documentation is mandatory.

---

# API Design Principles

Keep endpoints predictable.

Avoid deeply nested routes, but judge nesting by **aggregate boundaries**, not by raw URL segment count. A collection may be nested beneath its aggregate root when the child's identity is otherwise ambiguous without that root (e.g., a table is meaningless without its branch); that aggregate root may itself already be exposed through its own parent resource (e.g., a Branch, whose collection lives at `/restaurants/:restaurantId/branches` per Phase 5.1's approved, production-verified routing) - in that case the child's collection route naturally reflects the same path, and the resulting URL depth is not itself an architectural smell. What matters is that the nesting still traces a single, unbroken aggregate-ownership chain (Restaurant → Branch → Table), not an arbitrary combination of unrelated resources.

Whatever the collection route's depth, once a resource's own id is known it must also be reachable through a flat, directly-addressable route for read/update/delete (`/tables/:id`), independent of its parents' ids. Never construct a route that skips a level of the ownership chain or combines resources that are not in a direct aggregate relationship.

Example (Branch → Table, matching the implemented, production-verified architecture):

* Collection, nested under the full aggregate-ownership chain: `POST /restaurants/:restaurantId/branches/:branchId/tables`, `GET /restaurants/:restaurantId/branches/:branchId/tables`
* Individual resource, flat once the table's own id is known: `GET /tables/:tableId`, `PATCH /tables/:tableId`, `DELETE /tables/:tableId`

Domain actions (business commands that don't fit generic CRUD) use `POST` on an action-suffixed sub-route, not `PATCH`, even when they mutate only one field - `PATCH` is reserved for partial updates of a resource's own attributes. This is already the documented pattern for `POST /reservations/:id/reschedule` (see Idempotency, above); `POST /reservations/:id/approve` and `POST /reservations/:id/reject` (Phase 7.2 — Approval Workflow, complete and live-verified 2026-07-23; there is no `PATCH /reservations/:id`) follow the identical convention - Approve and Reject are each their own dedicated Domain Action, not folded into a single generic status endpoint, since they carry materially different side effects (Approve calls `Table.reserve()`; Reject performs no Table operation at all - see TASKS.md's "Phase 7.2 — Approval Workflow: Architecture Correction" note); `POST /reservations/:id/cancel`, `POST /reservations/:id/reschedule`, `POST /reservations/:id/complete`, and `POST /reservations/:id/no-show` (Phase 7.3 — Reservation Lifecycle, architecture frozen 2026-07-23, complete and live-verified 2026-07-23) follow the same convention for the same reason - each carries distinct side effects (Cancel-of-Approved and Complete/NoShow call `Table.release()`; Reschedule may call both `Table.release()` and `Table.reserve()` atomically when the assigned Table changes, per ADR-023; Cancel-of-Pending, Reject, and Reschedule-of-Pending perform no Table operation at all). Cancel and Reschedule are each reachable by both the Customer (own resource only) and a branch-scoped Employee on the same route - resolved by use-case-level actor branching (ownership check for a `User` actor, permission-slug + branch-scope check for an `Employee` actor), not by a NestJS guard composed with OR semantics; the route's own guard chain is `JwtAuthGuard` + `SessionVersionGuard` only, deliberately omitting `PermissionsGuard` (which would otherwise structurally deny every Customer actor). Complete and No-Show remain Employee-only, gated by `PermissionsGuard` + their own dedicated permission slugs, exactly like Approve/Reject. Expiration has no public endpoint at all - it remains internal, BullMQ-job-driven only. the Table Module's `POST /tables/:tableId/move` (Phase 6.2 architecture decision) follows the same convention - it reassigns a Table's `floorPlanId` to a different FloorPlan within the same Branch as a dedicated Domain Action, kept fully separate from `PATCH /tables/:tableId` (Update Table), which is responsible only for the Table's own attributes and never touches `floorPlanId`. `POST /tables/:tableId/status` (Status Management architecture decision) follows the identical convention for status transitions: one dedicated Domain Action covering every transition (`{ "status": "<TableStatus>" }`), not separate `disable`/`enable` sub-routes - disabling and enabling are state transitions within the Table lifecycle, not independent business capabilities. Restricted to the transitions `Available ↔ Occupied`, `Available ↔ Cleaning`, and `Available ↔ Disabled`; any other transition is rejected as a business validation error (including any attempt to set `Merged` or `Reserved` manually). Kept fully separate from `PATCH /tables/:tableId`, which never touches `status`. **ADR-026 / Phase 6 Merge-Split (architecture frozen 2026-07-25; implementation NOT started / NOT YET AUTHORIZED):** `POST /api/v1/tables/merge` (body `{ "tableIds": ["uuid", ...], "primaryTableId"?: "uuid" }` — at least two distinct `tableIds`; when supplied, `primaryTableId` must be one of them) and `POST /api/v1/tables/:tableId/split` (`:tableId` may be any member of the group; server resolves the merge group) are dedicated Domain Actions on the flat Tables surface — do not create branch-nested duplicate routes. Merge response must expose primary table, member table IDs, `effectiveCapacity`, and `mergeGroupId` using existing response-envelope conventions. Split returns the restored component tables. Authorization is dual-actor (OrganizationMember Owner/Admin **or** Employee with `tables:manage` + branch scope), resolved inside the use case with `JwtAuthGuard` + `SessionVersionGuard` only at the route (no NestJS OR-composed OrgRole/Permissions guards) — see AUTHORIZATION_ARCHITECTURE.md and ADR-026.

**Customer Restaurant Discovery & Public Read Surface (2026-07-28):** the management routes under `/restaurants`, `/restaurants/:restaurantId/branches`, and their Table/FloorPlan children are Owner/Admin-only (`OrganizationMemberGuard`) and cannot also serve public Customer reads on the same path (a route cannot carry two different guard chains). Public/unauthenticated browsing therefore lives on a parallel, deliberately separate path family, `GET /discovery/restaurants[/:restaurantId[/branches[/:branchId[/floor-plan]]]]`, owned by a new `DiscoveryModule` (`@ApiTags('Discovery')`, distinct from `@ApiTags('Restaurants')`/`@ApiTags('Branches')`/`@ApiTags('Tables')` in Swagger) - this is the minimal customer-facing slice of ADR-018's already-reserved `modules/discovery/` name, not its future Phase 15.5 search/nearby/ranking engine (no filter, sort, geo-bounding-box, or comparison logic lives here). Every response reuses the exact same Response DTOs (`RestaurantResponseDto`, `BranchResponseDto`, `FloorPlanResponseDto`, `TableResponseDto`) the management endpoints already return - those shapes never carried an `organizationId` or other internal field to begin with. `GET /reservations` and `GET /reservations/:id` (Customer's own reservations only, ownership-checked, IDOR-safe 404) were added to the existing `ReservationsController` on the same customer-facing `/reservations` resource, no new path family needed.

**Phase 15.5 (Discovery Module, architecture frozen 2026-07-29, complete/live-verified/production-verified 2026-07-30):** extends this same `DiscoveryModule`/`@ApiTags('Discovery')` surface with `GET /discovery/restaurants/nearby` and `POST /discovery/restaurants/compare` (new routes) plus filter/sort query params on the existing `GET /discovery/restaurants`. Implementation note: `GET .../nearby` must be registered before the existing `GET .../:restaurantId` handler in `DiscoveryController`, since NestJS/Express matches routes in declaration order and `:restaurantId` would otherwise capture the literal segment `nearby` (failing its `ParseUUIDPipe`); `POST .../compare` has no such ordering constraint (distinct HTTP verb). The same session also corrects the existing `.../floor-plan` endpoint's response, replacing the reused internal `TableResponseDto` with a dedicated customer-safe projection that excludes `mergeGroupId`, `isMergePrimary`, and operational `status` - see `TASKS.md`'s Phase 15.5 decision note (D11) for the exact frozen field list.

Prefer filtering over custom endpoints.

Ensure backward compatibility between API versions.

Deprecate endpoints before removal, signaled via a `Deprecation` header (RFC 8594) and a `Sunset` header giving the removal date; the deprecation period must be at least one minor version.

---

# Webhook Endpoints

Inbound webhooks (e.g., OneSignal delivery receipts) are a distinct category from client-facing endpoints:

* Every webhook endpoint verifies the provider's signature (HMAC or provider-specific scheme) before processing; an invalid signature returns `401 Unauthorized` without processing the payload.
* Webhook handlers are idempotent — a provider may deliver the same event more than once, and processing it twice must not duplicate side effects.
* Webhook payloads are persisted before triggering any business logic, so a processing failure can be replayed from the stored payload rather than lost.

TAVLA does not process payments and has no payment-provider webhook integration (Owner Decision, 2026-07-28 — see `TASKS.md` Phase 13).

---

# Error Codes

Use consistent application error codes.

Example:

AUTH_INVALID_TOKEN

AUTH_EXPIRED_TOKEN

AUTH_INVALID_CREDENTIALS

AUTH_INVALID_REFRESH_TOKEN

AUTH_EMAIL_NOT_VERIFIED

AUTH_ACCOUNT_LOCKED

AUTH_ACCOUNT_SUSPENDED

AUTH_PASSWORD_REUSED

AUTH_TOO_MANY_SESSIONS

AUTH_SESSION_NOT_FOUND

CONFLICT

RATE_LIMIT_EXCEEDED

RESERVATION_CONFLICT

RESERVATION_RESCHEDULE_WINDOW_EXPIRED

PARTY_SIZE_EXCEEDS_CAPACITY

TABLE_UNAVAILABLE

TABLE_MERGE_CONFLICT

BRANCH_HAS_FUTURE_RESERVATIONS

RESTAURANT_NOT_FOUND

RESTAURANT_SUSPENDED

ORGANIZATION_LIMIT_EXCEEDED

GALLERY_LIMIT_EXCEEDED

EMPLOYEE_BRANCH_NOT_ASSIGNED

TENANT_CONTEXT_MISSING

IDEMPOTENCY_KEY_CONFLICT

VALIDATION_ERROR

UNAUTHORIZED

FORBIDDEN

NOT_FOUND

UNKNOWN_ERROR

FILE_TOO_LARGE

UNSUPPORTED_FILE_TYPE

INVALID_FILE

STORAGE_UNAVAILABLE

---

# Reservation Availability Search Response Contract

`GET /reservations/availability` (Phase 7.1 architecture decision, 2026-07-20) is informational only and never hides a table from the response.

* The response includes every table matching the search criteria (branch, date/time, party size against capacity, `TableStatus = Available`).
* Every table in the response carries an explicit availability indicator.
* A table already holding a `Pending` or `Approved` reservation for the requested window is still returned, marked Reserved/Unavailable rather than omitted.
* Clients must not infer availability merely from a table's presence in the response — presence means "matches the search criteria," not "bookable." Clients must read the availability indicator on each table.
* The UI is responsible for how the Reserved/Unavailable state is displayed.
* This endpoint performs no conflict check and reserves nothing. Reservation creation (`POST /reservations`) remains the sole authoritative conflict check, enforced at two independent layers per ADR-013 (an advisory lock and a database exclusion constraint) - a table shown as available here may no longer be available by the time a client submits a create request, and vice versa.

---

# Notification Endpoints (Phase 9, implemented 2026-07-25)

Minimum v1 REST surface for the Customer's own durable notification inbox (`TASKS.md`'s Phase 9 decision item 12), all under `JwtAuthGuard`/`SessionVersionGuard`, ownership-only authorization (`AUTHORIZATION_ARCHITECTURE.md` §10 — `notification.userId === principal.userId`, no RBAC permission slug):

| Method | Route | Notes |
|---|---|---|
| `GET` | `/api/v1/notifications` | Own notifications only; paginated (existing cursor/offset convention); default order newest-first; optional `unread=true` filter |
| `PATCH` | `/api/v1/notifications/:id/read` | Marks one notification read; a non-owned `:id` returns 404, not 403 (IDOR-safe, matching every other owned-resource route) |
| `PATCH` | `/api/v1/notifications/read-all` | Marks all of the caller's unread notifications read |
| `GET` | `/api/v1/notifications/unread-count` | Returns a single count for a badge/indicator |
| `GET` | `/api/v1/notifications/identity-token` | ADR-025 on-demand path: short-lived OneSignal Identity-Verification JWT for the caller (`external_id = User.id`). Returns `{ token, expiresInSeconds }`; `token` is `null` when Identity Verification is unconfigured. Used on app-open and when the OneSignal SDK fires its JWT-invalidation listener |

Response DTOs for the inbox routes expose only `id`, `type`, `title`, `body`, `data`, `read`, `readAt`, `createdAt` — never the internal delivery-tracking fields (`pushStatus`, `pushSentAt`, `pushFailedAt`, `pushFailureReason`, `pushIdempotencyKey`, `pushProviderMessageId`), which are never part of the client-facing contract.

**ADR-025 initial delivery (also owner-approved 2026-07-25):** `onesignalIdentityToken: string | null` is included on `POST /api/v1/auth/customer/login` and on `POST /api/v1/auth/refresh` for Customer (`User`) actors. It is not a Tavola session token and is never accepted by any Tavola guard.

**No admin/staff notification API** in v1 — no Employee/OrganizationMember recipient exists yet (Phase 9 decision item 2), so there is nothing for staff to administer. **No server-side push-subscription-registration endpoint** — the OneSignal client SDK registers subscriptions directly against `external_id` (Phase 9 decision item 3); a Tavola-side registration endpoint would be redundant and is not built.

---

# Analytics Endpoints (Phase 14, ADR-028, implemented 2026-07-28)

Operational restaurant analytics only — direct PostgreSQL reads, no mutation endpoints. All routes: `JwtAuthGuard` + `SessionVersionGuard` only; authorization resolved inside the use case (Organization Owner/Admin **or** Employee with `reports:view` + branch assignment where applicable), the same dual-actor shape ADR-026 already established — no NestJS OR-composed guard.

| Method | Route | Scope | Notes |
|---|---|---|---|
| `GET` | `/api/v1/restaurants/:restaurantId/analytics/reservations/summary` | Restaurant (aggregates branches) or `?branchId=` | Status counts, source breakdown, completion/no-show/cancellation rate, average party size — no timezone bucketing, safe at Restaurant/Organization scope |
| `GET` | `/api/v1/restaurants/:restaurantId/analytics/branches/:branchId/reservations/trends` | Branch (required) | Service-day trend, booking-created trend — zero-filled daily buckets, Branch-local calendar day |
| `GET` | `/api/v1/restaurants/:restaurantId/analytics/branches/:branchId/peak-hours` | Branch (required) | 24 zero-filled hourly buckets, Branch-local |
| `GET` | `/api/v1/restaurants/:restaurantId/analytics/customers` | Restaurant or `?branchId=` | Unique/returning registered customers, guest-backed count, avg party size |
| `GET` | `/api/v1/restaurants/:restaurantId/analytics/waitlist` | Restaurant or `?branchId=` | Entry/outcome counts, closed-entry conversion rate |
| `GET` | `/api/v1/restaurants/:restaurantId/analytics/reviews-summary` | Restaurant | Active review count, average rating |
| `GET` | `/api/v1/organization/analytics/reservations/summary` | Organization | Aggregates every Restaurant the tenant-scoped `RestaurantRepository` resolves for the caller's organization. No `:organizationId` path segment — confirmed at implementation time that no route in this codebase carries one; `organizationId` always comes from the JWT (`GET /restaurants` precedent) |

All six Restaurant/Branch-scope routes live on one `AnalyticsController` mounted at `restaurants/:restaurantId/analytics`; the Organization-scope route lives on its own `OrganizationAnalyticsController`. **Branch scope is mandatory for any timezone-bucketed series** (trends, peak hours) — Restaurant/Organization-scope endpoints never silently combine two branches' local calendar buckets into one series; they expose only non-bucketed aggregates instead. Query DTO: `dateFrom`/`dateTo` (`YYYY-MM-DD`, `@Matches` date-only pattern — not `@IsDateString()`, which also accepts full ISO timestamps this contract deliberately excludes) or a `range` preset (`today`/`last7d`/`last30d`/`thisMonth`), max span 366 days; optional `branchId` (`@IsUUID()`) on the Restaurant-scope routes only. No pagination — every response is a fixed-shape KPI object or a bounded, zero-filled time-series, not a list. Rates are numeric ratios (`0.0`–`1.0`), never percentage strings; a zero denominator returns `null`, not `0` or an omitted field. Every response includes `generatedAt` inside `data` (the shared envelope's `meta` is always `{}` and cannot carry it). Aggregate-only payloads — no `ReservationGuest` PII field, no raw customer/guest list, ever. Full formula rationale: `TASKS.md`'s Phase 14 section and `DECISIONS.md` ADR-028.

---

# Idempotency

Sensitive operations such as reservation creation should support idempotency keys where appropriate.

Concretely: the client supplies an `Idempotency-Key` header (a client-generated UUID) on the request. The server stores the key alongside the resulting response for 24 hours; a repeated request with the same key within that window returns the original stored response (same status code and body) without re-executing the operation, rather than creating a duplicate resource. A repeated request with the same key but a materially different body returns `422 Unprocessable Entity` with error code `IDEMPOTENCY_KEY_CONFLICT`. This applies to `POST /reservations` and `POST /reservations/:id/reschedule`.

---

# Rate Limiting

Authentication endpoints:

Strict limits.

Public search endpoints:

Moderate limits.

**Frozen (Phase 15.5, 2026-07-29):** all `/discovery/**` routes (the existing 2026-07-28 browsing routes and the new search/nearby/compare routes alike) share one tier — **60 requests / 60 seconds per client IP**, enforced by a Discovery-scoped policy reusing the existing Redis sliding-window rate-limiting primitive (`RateLimiterPort`), not Authentication's own closed policy registry and not a global throttler. Exceeding the limit returns `429` with the standard error envelope; a Redis outage fails closed (request fails), matching the existing rate limiter's current behavior. See `TASKS.md`'s Phase 15.5 decision note (D12) for the full rationale.

Internal authenticated APIs:

Role-based limits where necessary.
