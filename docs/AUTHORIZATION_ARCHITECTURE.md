# AUTHORIZATION_ARCHITECTURE.md

# Enterprise Restaurant Reservation Platform

Version: 1.0  
Phase: **2.0.1 — Authorization Architecture** (documentation only; no implementation yet)

---

# Purpose

This document is the **single source of truth** for Authorization — what an authenticated principal is allowed to do, on which resources, and within which scope.

| Concern | Question | Owner document |
|---|---|---|
| **Authentication** | Who are you? | `AUTHENTICATION_ARCHITECTURE.md` |
| **Authorization** | What may you do? | **This document** |
| **Tenant isolation** | Which organization's data may you see? | `TENANCY.md` |

Authentication establishes identity and issues credentials. Authorization evaluates permissions, policies, scopes, and limits **after** identity is proven. These modules must not be merged.

Related documents: `DECISIONS.md` (ADR-017), `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, `EVENTS.md`, `TENANCY.md`.

---

# 1. Authorization Philosophy

## 1.1 Core Principles

1. **Fail closed** — if authorization cannot be determined, deny.
2. **Default deny** — no permission is implied; every protected action requires an explicit grant or policy allow.
3. **Separation from authentication** — JWT proves identity; guards and policies prove entitlement.
4. **Domain-first policies** — business modules depend on policy interfaces, not NestJS guards, in Application/Domain layers.
5. **Scope is not permission** — holding `reservations:approve` does not bypass branch scope; both must pass.
6. **Deny beats grant** — explicit revocations and deny rules override role defaults.
7. **Versioned, not infinitely cached** — permissions are embedded in short-lived JWTs with a version stamp; changes propagate on refresh, not on stale Redis caches.
8. **Extensible without redesign** — Phase 2 ships RBAC + policy classes; ABAC, feature flags, subscription limits, and temporal rules plug into the same Policy Engine interface.

## 1.2 What Authorization Is Not

| Not authorization | Belongs to |
|---|---|
| Password verification | Authentication |
| JWT signing / refresh rotation | Authentication |
| `organizationId` query scoping | Tenancy (Prisma extension) |
| Subscription usage counting | Subscription domain (authorization *consumes* limits) |
| Input validation | Presentation layer |

## 1.3 Module Layout (Phase 2+ Implementation Target)

```
apps/backend/src/modules/authorization/
├── domain/
│   ├── policies/              # ReservationPolicy, TablePolicy, … (interfaces + rules)
│   ├── services/              # PermissionResolver, PolicyEngine (interfaces)
│   ├── value-objects/         # PermissionSlug, ScopeContext, AuthorizationDecision
│   └── exceptions/              # PermissionDeniedException, ScopeViolationException
├── application/
│   ├── resolvers/             # RbacPermissionResolver, OrganizationRoleResolver
│   └── ports/                 # PermissionRepository, PolicyContextPort
├── infrastructure/
│   ├── persistence/           # Prisma permission queries
│   └── cache/                 # Optional request-scoped memoization only
└── presentation/
    ├── guards/                # PermissionsGuard, BranchScopeGuard, OrganizationMemberGuard
    └── decorators/            # @RequirePermission(), @RequirePolicy(), @RequireOrgRole()
```

Authentication module retains **only** `JwtAuthGuard` (identity). All entitlement checks live in Authorization.

---

# 2. RBAC Architecture

## 2.1 Two Layers (Unchanged from ADR-016, Owned Here)

| Layer | Storage | Scope | Resolver |
|---|---|---|---|
| **Organization administrative** | `OrganizationMember.role` enum | Organization | `OrganizationRoleResolver` |
| **Restaurant operational** | `Roles` + `Permissions` + `RolePermissions` | Restaurant / Branch | `PermissionResolver` (RBAC path) |

RBAC answers: *does this principal hold permission slug X?*  
Scope guards answer: *may they exercise it on this branch/resource?*  
Policies answer: *given business context, is this specific action allowed?*

## 2.2 Role Types

| Role source | Examples | Hierarchy |
|---|---|---|
| Platform | `PlatformAdmin`, `PlatformSupport` (ADR-034 §11 — two-tier, `PlatformAdminClaims.role`; `PlatformSupport` is read-only, no mutation authority) | Above all tenants |
| Organization member | `Owner` > `Admin` > `Billing` > `Staff` | Org-wide admin |
| Employee (operational) | `Manager` > `Receptionist`, `Cashier` | Restaurant ops (flat permission sets per role, not inheritance tree in Phase 2) |
| Implicit customer | `Customer` | No Employee record; resource-owner rules only |

## 2.3 Permission Slugs

Format: `<resource>:<action>` (e.g., `reservations:approve`, `tables:manage`).

Stored in `Permissions.slug`. Seeded at deploy; extended via migrations + seed, never hardcoded in business logic.

---

# 3. Permission Model

## 3.1 Entities (DATABASE_SCHEMA.md)

| Concept | Physical storage | Notes |
|---|---|---|
| Permission | `Permissions` | Atomic capability |
| Role | `Roles` | Grouping for employees |
| Role grant | `RolePermissions` where `type = RoleGrant` | Role → permission |
| Individual grant | `RolePermissions` where `type = IndividualGrant`, `employeeId` set | Employee override |
| Individual revocation | `RolePermissions` where `type = IndividualRevocation`, `employeeId` set | Deny override |
| Employee role | `Employees.roleId` → `Roles` | **Not** a separate `EmployeeRole` table |
| User permission | **No `UserPermission` table** | Employee overrides use `RolePermissions.employeeId`; org admin uses `OrganizationMember.role`; future ABAC uses `PermissionAssignment` (§21) |
| Permission version | `Users.permissionsVersion`, `Employees.permissionsVersion` | Bumped on any grant/revoke/role change |
| Session version | `Users.sessionVersion` | Bumped on global logout / security events (Authentication doc) |

## 3.2 Effective Permission Formula

For an **Employee**:

```
effectivePermissions =
    (RolePermissions[employee.roleId] where type = RoleGrant)
    ∪ IndividualGrants[employeeId]
    − IndividualRevocations[employeeId]
```

For **OrganizationMember** (admin actions):

```
allowed = OrganizationRoleMatrix[member.role].allows(action)
```

For **Customer** (`User`):

```
allowed = ResourceOwnershipPolicy OR public-action whitelist
```

---

# 4. Role Hierarchy

```
PlatformAdmin / PlatformSupport  (platform scope — Explicit Tenant Rebind / Tenant-Agnostic Raw Reader, ADR-035; two-tier role, ADR-034)
    │
OrganizationMember.Owner         (tenant admin — billing, members, restaurants)
    │
OrganizationMember.Admin
    │
OrganizationMember.Billing
    │
OrganizationMember.Staff
    │
    ├── Employee.Manager         (restaurant ops — broad operational set)
    ├── Employee.Receptionist
    └── Employee.Cashier
    │
Customer (User)                  (no org/employee role — owns own resources)
```

Hierarchy defines **organizational authority**, not automatic permission inheritance between operational roles. A Manager does not inherit Receptionist permissions implicitly — each role has an explicit permission set in seed data.

---

# 5. Permission Hierarchy

Permissions are **flat slugs**, grouped logically for documentation and UI:

| Namespace | Examples | Typical roles |
|---|---|---|
| `organization:*` | `organization:members:manage` | Owner, Admin |
| `restaurants:*` | `restaurants:manage` | Owner, Admin, Manager |
| `branches:*` | `branches:manage` | Manager |
| `reservations:*` | `reservations:create`, `reservations:approve`, `reservations:cancel`, `reservations:reschedule`, `reservations:complete`, `reservations:noshow`, `reservations:waitlist`, `reservations:tableready` | Receptionist, Manager |
| `tables:*` | `tables:manage` | Manager |

**ADR-026 / Phase 6 Merge-Split (architecture frozen 2026-07-25; implemented, live-verified 2026-07-26 — see TASKS.md's Phase 6 Merge/Split Implementation & Verification Report):** Merge and Split reuse the existing seeded `tables:manage` slug — **do not** create `tables:merge` or `tables:split`. They are staff-side table-management operations with a **narrow dual-actor** model:

* **OrganizationMember** Owner/Admin — existing organization-level table-management authority (same org ownership chain as today's Table CRUD), **or**
* **Employee** — must hold `tables:manage` **and** be assigned to the target Branch.

Route shape: `JwtAuthGuard` + `SessionVersionGuard` only; actor-type branching and OrgRole / permission+branch checks happen **inside the use case** (same pattern as Phase 7.3 Cancel/Reschedule dual-actor routes). This deliberately avoids NestJS multi-guard OR composition. ADR-026 itself satisfies `CHANGE_POLICY.md` criterion #4 for this narrowly scoped auth extension. **Do not** migrate every existing Table CRUD endpoint to this model in the Merge/Split phase — CRUD remains Owner/Admin-only until a separate authorization increment. Cross-organization access remains IDOR-safe (unknown/foreign tables → 404 via tenant chain).
| `employees:*` | `employees:manage` | Manager |
| `reports:*` | `reports:view` | Manager, Owner |
| `offers:*` | `offers:manage` | Manager |
| `conversations:*` | `conversations:manage` | Manager, Receptionist |
| `menu:*` (Phase 18, architecture frozen 2026-08-02, ADR-031 — not implemented) | `menu:manage` | Manager |

**Phase 14 — Analytics (implemented and live-verified 2026-07-28, ADR-028):** `reports:view` gets its first real consumer. No new slug — the seeded-but-previously-unused `reports:view` (`prisma/seed.ts`, already granted to `manager`) guards every Analytics route. Route shape follows ADR-026's precedent exactly: `JwtAuthGuard` + `SessionVersionGuard` only at the route; the use case branches OrganizationMember Owner/Admin **or** Employee with `reports:view` (+ branch assignment for Branch-scoped queries) — no NestJS OR-composed guard is introduced.

**Phase 15.6 — Messaging (architecture designed 2026-07-30, ADR-020 corrected by ADR-030; see DECISIONS.md D15):** `conversations:manage` is a new, dedicated slug — no existing permission fits (unlike Analytics' reuse of `reports:view`). Same narrow dual-actor shape as ADR-026/ADR-028: `JwtAuthGuard` + `SessionVersionGuard` only at the route; `assertActorCanManageConversation`/`resolveMessagingActorId` (mirroring `assertActorCanManageTables`/`resolveTableManagementActorId`) branch inside each staff-facing use case between **OrganizationMember** Owner/Admin (org-scoped) **or** **Employee** holding `conversations:manage` **and** assigned to the conversation's Branch (branch-scoped). The Customer (`User`) side of every shared endpoint is single-actor: ownership check only (`conversation`'s `Customer` participant `userId` match), no permission slug involved. Cross-tenant/cross-branch resolution is IDOR-safe (D14): unresolvable → 404, resolvable-but-unauthorized → 403.

**Phase 18 — Menu Management (architecture frozen 2026-08-02, ADR-031 — not implemented, no code exists):** `menu:manage` is a new, dedicated slug, single-actor (no dual-actor OR-branching needed — unlike Merge/Split, Analytics, or Messaging, Menu management has no ownership-based Customer write path to disambiguate against). `OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)` **or** `PermissionsGuard` + `@RequirePermission('menu:manage')` for an Employee — the same two-guard-shape-not-composed pattern `RestaurantsController`'s gallery/settings endpoints already use, resolved per-route rather than via a single OR-composed guard. Default role assignment (least-privilege, mirroring `tables:manage`'s existing Manager-only grant): **Manager** receives it; **Receptionist**/**Cashier** do not — Menu content changes are a back-of-house/managerial responsibility, not a front-of-house one. Customer read access to the public Menu endpoints (`List Restaurant Menu`, `Get Category`, `Get Item Details`) carries **no guard at all** — genuinely public/unauthenticated, matching the existing Discovery/public-Offer-listing/`TaxonomyCategoriesController` precedent. Cross-organization management access remains IDOR-safe (unknown/foreign/soft-deleted Menu/Category/Item → 404 via the `restaurantId -> Restaurant.organizationId` tenancy chain).

Namespace depth is conventional (colon-separated); authorization checks a single slug unless a policy aggregates multiple.

**Phase 7.3 — Reservation Lifecycle (architecture frozen 2026-07-23; complete, live-verified, and production-verified 2026-07-23):** `reservations:cancel`, `reservations:reschedule`, `reservations:complete`, and `reservations:noshow` are four new, dedicated slugs - none reuse `reservations:approve`, which remains scoped exactly to Approve/Reject (Phase 7.2). Default role assignment (least-privilege, derived from each seeded role's own documented responsibility): **Manager** ("full restaurant operational access") and **Receptionist** ("front-of-house reservation and guest management") each receive all four; **Cashier** ("payment and checkout operations") receives none, matching its existing narrow `reservations:create`-only scope. Cancel and Reschedule are unusual in this catalog: they are also reachable by a **Customer** actor for their own reservation, via ownership-based authorization (no permission slug involved for that path at all) rather than RBAC - see §19's policy note and API_GUIDELINES.md's Domain Action section for how one route resolves both actor types without new guard composition.

**Phase 7.6 — Operational Signals (architecture frozen 2026-07-24):** `reservations:tableready` is one new, dedicated slug guarding `POST /reservations/:id/table-ready` (`PermissionsGuard` + `@RequirePermission`, plus the same branch-scope `assertEmployeeCanActOnReservation` check Complete/No-Show already use) - staff-only, no Customer/ownership path, since marking a table ready is a front-of-house operational signal, not a party-initiated action. Default role assignment follows the same least-privilege pattern as Phase 7.3: **Manager** and **Receptionist** receive it; **Cashier** does not. The Reminder and Late-Arrival signals carry no permission slug at all - both are exclusively BullMQ-scheduled, System-attributed background jobs with no HTTP entry point and therefore nothing for RBAC to guard.

---

# 6. Permission Resolution Flow

```mermaid
flowchart TD
    A[Authenticated Request] --> B{Actor type?}
    B -->|PlatformAdmin| C[PlatformAdminGuard]
    B -->|OrganizationMember| D[OrganizationRoleResolver]
    B -->|Employee| E[PermissionResolver RBAC]
    B -->|User| F[ResourceOwnershipPolicy]
    C --> G[Policy Engine]
    D --> G
    E --> H{Permission in JWT?}
    H -->|version current| I[Use JWT permissions]
    H -->|version stale| J[Re-resolve from DB on refresh only]
    I --> K[BranchScopeGuard]
    J --> K
    F --> K
    K --> L[Domain Policy e.g. ReservationPolicy]
    L --> M{Allow?}
    M -->|yes| N[Execute use case]
    M -->|no| O[403 PermissionDeniedException]
```

**Steps:**

1. `JwtAuthGuard` — identity only (Authentication).
2. `TenantContextInterceptor` — bind `organizationId` (Tenancy).
3. `PermissionsGuard` — slug in effective set?
4. `BranchScopeGuard` — resource branch in scope?
5. **Policy Engine** — domain rules (state, ownership, subscription, flags).
6. Use case executes.

---

# 7. Policy Engine Architecture

## 7.1 Interface (Domain)

```typescript
// Conceptual — not implementation code
interface AuthorizationPolicy<TContext> {
  authorize(actor: Principal, action: string, context: TContext): AuthorizationDecision;
}

type AuthorizationDecision = { allowed: true } | { allowed: false; reason: string; code: string };
```

## 7.2 Engine

`PolicyEngine` orchestrates:

1. Collect applicable policies for the action (registry by resource type).
2. Evaluate in order: **deny rules → scope → RBAC → ABAC (future) → subscription limits → feature flags**.
3. First hard deny wins; all applicable allows required where configured as `requireAll`.

Business use cases call:

```typescript
await this.policyEngine.assertAllowed('reservations:approve', actor, reservationContext);
```

Never embed `if (employee.role === 'Manager')` in use cases.

## 7.3 Registration

Each feature module registers its policies at module init. Authorization module owns the registry; feature modules own policy implementations.

---

# 8. Guard Architecture (Presentation)

Guards run **after** `JwtAuthGuard`. Order matters:

| Order | Guard | Module |
|---|---|---|
| 1 | `JwtAuthGuard` | Authentication |
| 2 | `TenantContextInterceptor` | Tenancy |
| 3 | `SessionVersionGuard` | Authentication |
| 4 | `PermissionsGuard` | Authorization |
| 5 | `BranchScopeGuard` | Authorization |
| 6 | `OrganizationMemberGuard` | Authorization |
| 7 | `PlatformAdminGuard` | Authorization |

Guards are thin: they read decorators + JWT claims and delegate to `PermissionResolver` / `PolicyEngine`. No database access in guards except via injected application services.

---

# 9. Decorator Architecture

| Decorator | Purpose | Example |
|---|---|---|
| `@RequirePermission('reservations:approve')` | RBAC slug required | Controller method |
| `@RequireAnyPermission(['a', 'b'])` | One of set | Read endpoints |
| `@RequireOrgRole('Owner', 'Admin')` | Organization admin role | Invite member |
| `@RequirePolicy(ReservationPolicy, 'approve')` | Domain policy | Complex rules |
| `@RequirePlatformAdminRole('PlatformAdmin')` | Platform two-tier role check (ADR-034 §11/§12, implemented Phase 19.1 via `PlatformAdminRoleGuard`) — clones the `@RequireOrgRole`/`OrganizationMemberGuard` pattern against `PlatformAdminClaims.role` instead of `AUTHENTICATED_ACTOR_KEY`; **not** an ADR-026/028-style dual-actor OR-composition | Restaurant/Organization Suspend/Reactivate/Delete/Restore, Ownership Transfer, Account access control, Platform Admin CRUD mutations (Acquisition Reversal/pricing mutation remain unimplemented, ADR-033) |
| `@Public()` | Skip auth (login, register) | Auth controller |
| `@SkipAuthorization()` | Authenticated but no permission check | `/auth/me` |

Decorators set metadata only; guards enforce.

---

# 10. Ownership Rules

| Principal | Owns / may access | Mechanism |
|---|---|---|
| **Platform Admin** | Cross-tenant read/write (audited) | `PlatformAdmin` role via Explicit Tenant Rebind (writes/single-tenant reads) or Tenant-Agnostic Raw Reader (platform-wide reads) — ADR-035 |
| **Platform Support** | Cross-tenant read only, no mutation (audited) | `PlatformSupport` role, same two mechanisms, read paths only — ADR-034 §11 |
| **Organization Owner** | Organization, all restaurants under org, billing, members | `OrganizationMember.role = Owner` |
| **Organization Admin** | Members, restaurants; not ownership transfer alone | Org role matrix |
| **Restaurant Manager** (Employee) | Restaurant ops per role permissions + branch scope | RBAC + branch assignments |
| **Receptionist** | Reservations, limited table read | RBAC subset |
| **Cashier** | Reservations (`reservations:create` only), read reservations — no payment/checkout functionality (TAVLA does not process payments) | RBAC subset |
| **Customer** | Own profile, own reservations, own reviews, own notifications (Phase 9, implemented 2026-07-25) | `userId` match on resource |
| **Reservation guest** | No account — staff creates on behalf | Staff permission, not customer JWT |

**Restaurant Owner (display):** the Organization member with `Owner` role — not a separate `Restaurant.ownerId` (ADR-011).

**Resource ownership check (customers):**

```
allowed ⇔ resource.userId === principal.userId
```

Staff bypass ownership only when holding the required permission slug **and** branch scope.

**Phase 9 Notification inbox (frozen 2026-07-25, `TASKS.md`'s Phase 9 decision item 13):** ownership-only, no RBAC — `notification.userId === principal.userId` is the entire authorization rule for `GET /notifications`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`, and `GET /notifications/unread-count`, mirroring `/users/me/*`'s existing precedent exactly. **No new permission slug is introduced** — v1 has no Employee/OrganizationMember recipient (see item 2), so there is nothing for RBAC to gate yet. A non-owned `:id` collapses to 404 (IDOR-safe), matching every other owned-resource route's existing convention.

---

# 11. Tenant Scope Resolution

Handled by **TENANCY.md** (Prisma extension), not duplicated here.

Authorization assumes tenant context is already bound. Authorization adds:

* Verify JWT `organizationId` matches resource's organization (defense in depth).
* `PlatformAdmin`/`PlatformSupport` bypass tenant scope only via the two named patterns in TENANCY.md (ADR-035): Explicit Tenant Rebind (one known target tenant) or Tenant-Agnostic Raw Reader (genuinely cross-tenant reads). Neither is the default client injected into a feature-module repository.

---

# 12. Branch Scope Resolution

```typescript
// Conceptual
function isBranchAllowed(employee: EmployeeContext, branchId: string): boolean {
  if (employee.branchIds.length === 0) return true; // restaurant-wide
  return employee.branchIds.includes(branchId);
}
```

Enforced by `BranchScopeGuard` + `EmployeeBranchAssignment` data.

Failure: `EmployeeBranchNotAssignedException` (403).

---

# 13. Organization Scope Resolution

Organization-scoped actions (invite member, view billing) require:

1. `actorType === OrganizationMember` (or Employee also being a member — rare).
2. `OrganizationMember.role` satisfies `OrganizationRoleMatrix` for the action.
3. `organizationId` in JWT matches target organization.

Employees without `OrganizationMember` record cannot perform org-admin actions even with operational permissions.

---

# 14. Permission Inheritance

| Type | Inherits? | Mechanism |
|---|---|---|
| Operational role → role | **No automatic inheritance** | Each role has explicit seed grants |
| Role → employee | **Yes** | `Employees.roleId` → `RolePermissions` |
| Org Owner → Admin | **No** | Separate enum capabilities |
| Customer → Employee | **No** | Separate actor types |

Future: `Roles.parentRoleId` may add inheritance; resolver would flatten transitive grants at resolve time.

---

# 15. Permission Overrides

Stored in `RolePermissions` with `employeeId`:

| Type | Effect |
|---|---|
| `IndividualGrant` | Adds permission not in role |
| `IndividualRevocation` | Removes permission despite role |

Overrides are audited via `PermissionGranted` / `PermissionRevoked` events and bump `Employees.permissionsVersion`.

---

# 16. Permission Deny Rules

Evaluation order:

1. **Explicit revocation** (`IndividualRevocation`) — always wins.
2. **Emergency lockdown** (§26) — denies all non-platform actions.
3. **Country restriction** (§25) — deny if branch country blocked.
4. **Subscription limit** (§22) — deny create actions when over limit.
5. **Feature flag off** (§21) — deny feature endpoints.
6. **RBAC missing grant** — deny.
7. **Policy deny** — domain rule rejection.

---

# 17. Permission Versioning

| Field | Location | Bumped when |
|---|---|---|
| `permissionsVersion` | `Users`, `Employees` | Role change, grant, revoke, branch assignment change |
| Embedded in JWT | Access token claim | At login / refresh |
| `DeviceSession.permissionsVersion` | Snapshot at issue | Audit only |

**Stale access token:** if `JWT.permissionsVersion < current`, token still valid until expiry (≤15 min). Refresh always re-resolves.

**Never:** long-lived Redis cache as source of truth for permissions (NON_FUNCTIONAL_REQUIREMENTS.md).

---

# 18. Permission Cache Strategy

| Cache | Allowed? | TTL | Invalidation |
|---|---|---|---|
| JWT claims | Yes | Access token TTL | Refresh / version bump |
| Request-scoped memo | Yes | Single request | Automatic |
| Redis permission cache | **No** (Phase 2) | — | — |
| In-process LRU | **No** | — | — |

Optional future: Redis cache keyed by `(userId, permissionsVersion)` — only when version matches DB; still re-check version on each request.

---

# 19. Policy Classes

Each policy exposes a simple decision interface. Application services depend on policies, not guards.

| Policy | Responsibilities |
|---|---|
| `ReservationPolicy` | Status transitions, cancellation window, party size, branch scope, phone-reservation rules |
| `RestaurantPolicy` | Suspended restaurant, subscription active, org membership |
| `TablePolicy` | Merge/split (ADR-026: Primary Table membership, `Merged` secondaries, Move/Status-while-merged guards), floor-plan edits, disabled table |

**ADR-026 Merge/Split dual-actor note (architecture frozen 2026-07-25):** conceptually `TablePolicy.canMerge` / `canSplit` evaluate: (a) OrganizationMember Owner/Admin of the organization that transitively owns the tables, **or** (b) Employee with `tables:manage` and branch scope for the tables' `branchId`. Domain rules (same FloorPlan, Available members, reservation blocking, topology locks) remain in the Merge/Split use cases / domain layer, not in the policy alone. Distinct from Phase 7.0's still-deferred Manager-driven `employees:manage` OR-guard composition: Merge/Split does not introduce a new NestJS composed guard.
| `EmployeePolicy` | Invite, assign role, branch assignment, cannot remove last manager |
| `OfferPolicy` | Create/update (`Draft` only), publish, expire, delete — Owner/Admin only |
| `ReviewPolicy` | Customer owns review (create, own-delete); Organization Owner/Admin administrative delete; Organization Owner/Admin only reply (zero-or-one, immutable) |

**Phase 10 — Reviews (architecture frozen, owner-approved):** `ReviewPolicy` resolves two independent authorization shapes, neither of them a dual-guard OR-composition:

* **Submit Review** — pure ownership, no RBAC: `Review.reservationId` must reference a `Completed` reservation with `reservation.userId === principal.userId`. A guest-only reservation (`userId === null`) has no eligible submitter in Phase 10.
* **Delete Review** — reachable by **either** the owning Customer (ownership check, `Review.userId === principal.userId`) **or** an Organization Owner/Admin of the Restaurant the Review belongs to (`OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)`) — two independent, non-overlapping authorization paths on one route, resolved inside the use case exactly like Cancel Reservation's Customer/Employee dual-actor precedent, except here the second actor is Owner/Admin, not Employee. **Employees may not delete Reviews in Phase 10.**
* **Reply to Review** — Organization Owner/Admin only (`OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)`), the same org-role gate `RestaurantsController`'s own gallery/settings endpoints already use. **No Employee reply path, and no `reviews:reply` (or any other) permission slug is introduced in Phase 10** — this was evaluated and explicitly rejected as unnecessary scope for this phase (a documented alternative for a future phase, not adopted now).

A Review/foreign-organization Restaurant, or an unknown Review id, collapses to **404** for every one of the above actions (IDOR-safe, matching every other owned/tenant-scoped resource's existing convention) — never a distinguishing 403 that would confirm the resource's existence to an unauthorized caller.

**Customer Restaurant Discovery & Public Read Surface (owner-authorized, implemented 2026-07-28):** `GET /discovery/restaurants[/:restaurantId[/branches[/:branchId[/floor-plan]]]]` carries **no guard at all** - genuinely public/unauthenticated, matching ADR-018 §4 ("Search/nearby endpoints are public with rate limiting") and the pre-existing `TaxonomyCategoriesController`/public-Review-listing precedent. This is a parallel read path, not a change to the Owner/Admin management routes at the same resource names (`/restaurants`, `/restaurants/:id/branches`, `/tables`), which remain exactly as `OrganizationMemberGuard`-gated as before. Separately, `GET /reservations` and `GET /reservations/:id` (Customer's own reservations) extend `ReservationsController`'s existing ownership-only shape (`JwtAuthGuard`/`SessionVersionGuard` only, no RBAC) - `resource.userId === principal.userId`, IDOR-safe 404 for any other actor's reservation, exactly like Reviews' `listMine`/`/users/me/favorites`. No new permission slug, no new guard, no change to `PermissionResolver`.

**Phase 11 — Offers (architecture frozen, owner-approved, implemented and live-verified 2026-07-28):** `OfferPolicy` is single-actor, no dual-guard shape. Every management action (Create, Update, Publish, Delete) requires `OrganizationMemberGuard` + `@RequireOrgRole(Owner, Admin)` through the `Offer.restaurantId -> Restaurant.organizationId` ownership chain — the same org-role gate Restaurant Settings/Working Hours/Gallery/Taxonomy already use. **No Employee authorization path exists for any Offer action, and no `offers:*` permission slug is introduced** — evaluated and explicitly declined, the same shape Phase 10 declined for `reviews:reply`. System is authorized only for the automatic `Published -> Expired` transition (no principal, `actorType: 'System'`). Customer/User has read-only access to the restaurant-scoped public Offer listing (`Published`, currently active, not soft-deleted) — no write path of any kind. An unknown/foreign-organization/soft-deleted Offer collapses to **404** for every management action, matching the established IDOR-safe convention.

| `SubscriptionPolicy` | Plan limits, downgrade rules, feature gating |
| `AnalyticsPolicy` | Role-based report access, PII masking |
| `OrganizationPolicy` | Owner transfer, member invite/remove, sole Owner invariant |
| `FilePolicy` | Public vs private bucket, owner upload |

**Phase 14 — Analytics dual-actor note (implemented and live-verified 2026-07-28, ADR-028):** `AnalyticsPolicy` evaluates: (a) OrganizationMember Owner/Admin of the organization that transitively owns the queried Restaurant/Branch, **or** (b) Employee with `reports:view` and, for any Branch-scoped or timezone-bucketed query (Peak Hours, service-day trend, booking-created trend), branch assignment for the target `branchId`. PII masking means the response is aggregate-only by construction — no `ReservationGuest` field, no raw customer/guest list is ever assembled, so there is no separate masking step to apply. Same use-case-level branching shape as ADR-026's Merge/Split and Phase 7.3's Cancel/Reschedule; no new guard-composition mechanism.

**Example (conceptual):**

```typescript
ReservationPolicy.canApprove(actor, reservation):
  require permission 'reservations:approve'
  require branch scope reservation.branchId
  require reservation.status === Pending
  require restaurant not suspended
  require subscription allows reservations
```

**Phase 7.3 dual-actor note (architecture frozen 2026-07-23):** Cancel and Reschedule are authorized by *either* of two independent checks, not a composed guard - `actor.actorType === 'User' && reservation.userId === actor.userId` (ownership, no permission slug), *or* `actor.actorType === 'Employee' && actor.permissions.includes('reservations:cancel'|'reservations:reschedule') && branch scope reservation.branchId`. This is evaluated inside the use case itself (the same shape `assertEmployeeCanActOnReservation` already established for Approve/Reject, plus a new ownership branch mirroring `CreateReservationUseCase`'s own precedent), not by composing two NestJS Guards with OR semantics - it is therefore distinct from the still-unbuilt "multi-actor-type OR guard composition" TASKS.md's Phase 7.0 decision note flagged as requiring a new mandatory ADR under `CHANGE_POLICY.md` criterion #4 (that concern was specifically about two *permission-style* checks, e.g. OrgRole OR RBAC permission, needing to short-circuit at the guard layer - ownership-vs-permission is a different shape and needs no such mechanism). Complete/No-Show remain single-actor (Employee-only), authorized exactly like Approve/Reject.

---

# 20. Future ABAC Integration

Attribute-Based Access Control extends RBAC without replacing it.

**Phase 3+ attributes:**

* Resource attributes: `reservation.status`, `restaurant.tier`, `branch.countryCode`
* Actor attributes: `employee.tenure`, `organization.plan`
* Environment: time of day, IP country, emergency mode

**Integration point:** `PolicyEngine` evaluates ABAC rules after RBAC pass. Rules stored in `AuthorizationRule` table (future) or configuration service.

```
RBAC (coarse) → ABAC (fine) → Deny rules
```

RBAC remains the fast path; ABAC handles dynamic conditions RBAC cannot express.

---

# 21. Feature Flag Integration

`FeatureFlags` table (DATABASE_SCHEMA.md) storage; evaluation in Policy Engine.

```
if (!featureFlags.isEnabled('offers', organizationId)) deny
```

Flags never bypass authentication. Disabled feature → `403` with `FEATURE_DISABLED`.

---

# 22. Subscription-based Authorization

`SubscriptionValidator` (DOMAIN_MODEL.md) enforces plan limits **before** resource creation. Entitlement/access contract only (ADR-027) — no billing/payment concept is involved.

Authorization flow (Restaurant creation example):

1. RBAC: does actor hold `restaurants:create`?
2. Subscription policy: is `organization.usage.restaurants < plan.maxRestaurants`?

Authorization flow (Branch/Employee creation — **per-Restaurant** limits, ADR-027):

1. RBAC: does actor hold `branches:manage` / `employees:manage`?
2. Subscription policy: is `restaurant.usage.branches < plan.maxBranchesPerRestaurant`? (or `restaurant.usage.employees < plan.maxEmployeesPerRestaurant`) — checked against **the target Restaurant's own `RestaurantUsage` row**, never an Organization-wide sum, since these two limits apply individually to each Restaurant under the Organization, not to the Organization's aggregate total.

Limit exceeded → `OrganizationLimitExceededException` (403) in both cases — the exception name is retained even for the per-Restaurant checks, since the *plan* that defines the limit is still sourced from the Organization's one Subscription.

No `maxMonthlyReservations`/reservation-volume check exists anywhere in this flow (ADR-027, owner product decision) — `CreateReservationUseCase` has no subscription-entitlement dependency.

Usage counters are incremental (domain events), not live `COUNT(*)`.

---

# 23. Temporary Permissions

**Future table:** `PermissionAssignment`

| Field | Purpose |
|---|---|
| `principalId` | User or Employee |
| `permissionId` | Granted permission |
| `validFrom` / `validUntil` | Time window |
| `grantedBy` | Auditor |
| `reason` | Ticket reference |

Resolver includes grant only if `now ∈ [validFrom, validUntil]`.

Use cases: temporary Manager coverage, support access (audited).

---

# 24. Time-based Permissions

Examples:

* `employees:approve-reservations` only during `branch.workingHours`
* Scheduled offer publish — `OfferPolicy` + working schedule

Implemented in domain policies using `ClockPort` — not in guards.

---

# 25. Country-based Restrictions

Branch carries `countryCode`. Policy rules may deny actions when:

* Organization's markets exclude a country.
* Sanctions/compliance list (platform config).

```
CountryRestrictionPolicy.assertAllowed(actor, branch.countryCode)
```

Failures audited; may trigger `SecurityAlertRaised`.

---

# 26. Emergency Lockdown Mode

**`SystemConfiguration.emergencyLockdown`** (boolean).

When `true`:

* All staff operational permissions denied except `platform:lockdown:bypass` (Platform Admin).
* Customers may still view own reservations (read-only) unless config says otherwise.
* Existing sessions: `sessionVersion` bump optional on activation.

Toggle audited as `SecurityAlertRaised` with severity `critical`.

---

# Authorization Flow Summary

```
Identity proven (Authentication)
    → Tenant bound (Tenancy)
    → Session version valid (Authentication)
    → RBAC slug present (Authorization)
    → Scope valid: org / branch (Authorization)
    → Domain policy allows (Authorization / Policy Engine)
    → Subscription / feature flag / temporal rules (Authorization)
    → Use case executes
```

---

# Open Decisions (Deferred)

| Topic | Status | Notes |
|---|---|---|
| RS256 vs HS256 for JWT | Open | Authentication; does not affect authorization model |
| `Roles.parentRoleId` inheritance | Deferred | Seed flat roles in Phase 2 |
| Redis permission cache with version key | Deferred | Phase 3+ if profiling requires |
| `AuthorizationRule` ABAC table schema | Deferred | Policy Engine interface ready |
| Per-endpoint vs per-use-case policy invocation | **Decided:** use case level | Controllers stay thin |

---

# Approval

**Status:** ✅ Accepted (ADR-017). Phase 2.1 RBAC seed and Phase 2.2 domain layer complete; NestJS guards and Policy Engine wiring in Phase 2.13+.

Do not implement Authorization or Authentication code until ADR-016, ADR-017, and both architecture documents are approved.
