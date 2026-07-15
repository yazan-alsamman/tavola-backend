# VERSIONING.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

Defines versioning for the platform package, HTTP API, database schema, and security tokens. Prevents confusion between unrelated "version" concepts.

---

# Version Concepts (Do Not Conflate)

| Concept | Field / location | Purpose | Bumped when |
|---|---|---|---|
| **Platform release** | `package.json` `version` | Software delivery | Release per SemVer below |
| **API version** | URL prefix `/api/v1` | HTTP contract | Breaking API change |
| **Database schema** | Prisma migration history | Data structure | Each migration (timestamped) |
| **Session version** | `Users.sessionVersion` | Global logout-all | Logout-all, security events |
| **Permission version** | `Users`/`Employees.permissionsVersion` | Permission staleness | Role/override change |
| **ADR** | `ADR-NNN` in `DECISIONS.md` | Architecture decisions | New decision accepted |
| **Documentation** | Header `Version: X.Y` | Doc revision | Material doc change |

---

# Semantic Versioning (Platform)

The monorepo root `package.json` and `apps/backend/package.json` follow **[Semantic Versioning 2.0.0](https://semver.org/)**.

```
MAJOR.MINOR.PATCH
```

| Bump | When | Examples |
|---|---|---|
| **MAJOR** | Breaking API (`/api/v1` contract broken without v2), breaking config, incompatible migration requiring coordinated deploy | Remove endpoint, change auth flow |
| **MINOR** | New backward-compatible features, new endpoints, new optional fields | Add `POST /reservations/bulk` |
| **PATCH** | Bug fixes, security patches, performance fixes — no contract change | Fix validation bug |

### Pre-1.0 rules (current: `0.0.0`)

While `MAJOR = 0`:

* Platform is **pre-release** — no production SLA.
* **MINOR** bumps mark phase completions (e.g., `0.2.0` = Phase 2 auth complete).
* **PATCH** bumps mark fixes within a phase.
* First production release → `1.0.0` when Phase 15 exit criteria met or production launch declared.

### Version tagging

Git tags: `v{MAJOR}.{MINOR}.{PATCH}` (e.g., `v0.2.0`). See `RELEASE_POLICY.md`.

---

# API Versioning

## URL versioning (mandatory)

All REST endpoints are prefixed:

```
/api/v{major}
```

Current version: **`v1`**

Examples:

```
GET  /api/v1/restaurants
POST /api/v1/auth/login
```

WebSocket namespace (when implemented): `/api/v1/realtime` or documented equivalent in `EVENTS.md`.

## When to increment API major version

Create `/api/v2` when any **breaking** change affects existing clients:

* Remove or rename response/request fields.
* Change field types or semantics.
* Change authentication requirements.
* Change error codes or HTTP status for existing operations.
* Remove endpoints.

Non-breaking changes stay on current version:

* New endpoints.
* New **optional** request fields.
* New response fields (clients ignore unknown fields).
* New error codes for **new** failure modes.

## Deprecation policy

1. Mark endpoint/field `@deprecated` in Swagger.
2. Document in release notes (`RELEASE_POLICY.md`).
3. Maintain deprecated behavior for **minimum one MINOR release**.
4. Remove only in next MAJOR API version.
5. Return `Sunset` header (optional) with planned removal date.

## OpenAPI / Swagger

* Swagger served at `/api/v1/docs` (disabled in production by default).
* OpenAPI `info.version` tracks platform `package.json` version.
* Each API major version has independent Swagger document when v2 exists.

## Error code versioning

Error codes (`AUTH_*`, `VALIDATION_ERROR`, etc.) are part of the v1 contract. Never change meaning of an existing code — add a new code instead.

---

# Database Schema Versioning

* **No separate schema version number** — Prisma migration history is the version.
* Each migration folder: `YYYYMMDDHHMMSS_name`.
* Applied migrations recorded in `_prisma_migrations` table.
* Application code must tolerate **one version behind** during rolling deploys when using expand-contract (column added before code reads it).

### Compatibility rules

| Deploy order (expand-contract) | Safe |
|---|---|
| Migration → new code | Additive migrations |
| New code → migration | Destructive — forbidden |
| Migration + code atomic | Small teams / maintenance window only |

---

# Security Token Versioning

These are **runtime security counters**, not SemVer:

### Session version (`Users.sessionVersion`)

* Integer, starts at `1`.
* Incremented on logout-all and configured security events.
* JWT claim must match current value (`SessionVersionGuard`).

### Permission version (`permissionsVersion`)

* Integer on `User` and/or `Employee`.
* Incremented when roles, overrides, or branch assignments change.
* Embedded in JWT; re-resolved on token refresh.

### Token family (`tokenFamilyId`)

* UUID per login chain — not incremented; family revoked on replay.

Documented in `AUTHENTICATION_ARCHITECTURE.md` and `AUTHORIZATION_ARCHITECTURE.md`.

---

# Documentation Versioning

Architecture documents use header `Version: X.Y`:

| Change | Bump |
|---|---|
| Typo, formatting | No bump |
| Clarification, no semantic change | PATCH (1.0 → 1.1) |
| New section, changed behavior | MINOR |
| Supersedes prior specification | MAJOR |

Governance documents (`ARCHITECTURE_LOCK.md`, etc.) follow the same rule.

---

# Dependency Versioning

| Type | Policy |
|---|---|
| **Runtime dependencies** | Pin major; allow minor/patch via lockfile |
| **Security overrides** | `pnpm-workspace.yaml` overrides; document in PR |
| **Node.js** | `engines.node >= 20` in root `package.json` |
| **PostgreSQL** | 17+ per ADR-007; minor upgrades via ops runbook |

Major dependency upgrades (NestJS, Prisma major) require ADR or documented impact assessment.

---

# Client Compatibility Matrix (Future)

When mobile/web clients exist, maintain:

| Platform version | API version | Minimum client version |
|---|---|---|
| `0.2.x` | v1 | TBD |

Updated in release notes per `RELEASE_POLICY.md`.

---

# Related Documents

| Document | Relationship |
|---|---|
| `API_GUIDELINES.md` | REST conventions and error codes |
| `RELEASE_POLICY.md` | When versions are tagged and released |
| `CHANGE_POLICY.md` | Breaking change definition |
| `MIGRATION_POLICY.md` | Schema evolution |
| `ARCHITECTURE_LOCK.md` | Locked API base path |
