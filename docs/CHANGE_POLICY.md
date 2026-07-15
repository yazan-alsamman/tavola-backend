# CHANGE_POLICY.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

Defines how architectural, schema, API, and documentation changes are proposed, reviewed, approved, and recorded. Complements **ARCHITECTURE_LOCK.md** — locked decisions cannot change without this process.

---

# Change Categories

| Category | Examples | Required process |
|---|---|---|
| **Architectural** | New module pattern, replace Redis, merge auth/authz | New ADR + doc updates + approval |
| **Schema** | New table, column rename, index change | `DATABASE_SCHEMA.md` first → Prisma migration per `MIGRATION_POLICY.md` |
| **API contract** | New endpoint, field removal, status code change | `API_GUIDELINES.md` + Swagger; version bump if breaking (`VERSIONING.md`) |
| **Domain rule** | New business invariant, state transition | `DOMAIN_MODEL.md` + tests |
| **Security** | New guard, token claim, lockout rule | ADR or architecture doc + `EVENTS.md` if new events |
| **Documentation only** | Typos, clarifications without semantic change | PR review; no ADR |
| **Implementation detail** | Refactor within locked boundaries | PR + tests; no ADR |

When in doubt, treat the change as **Architectural** and write an ADR.

---

# When a New ADR Is Required

A new ADR in `DECISIONS.md` is **mandatory** before implementation when the change:

1. **Alters a locked decision** listed in `ARCHITECTURE_LOCK.md`.
2. **Introduces a new external dependency** (library, SaaS, infrastructure service).
3. **Changes the tenant isolation mechanism** or tenant boundary definition.
4. **Changes authentication or authorization model** (token format, permission resolution, guard behavior).
5. **Changes data retention or privacy handling** (GDPR, anonymization, consent).
6. **Introduces a breaking API change** that cannot be isolated to a new `/api/vN` prefix.
7. **Changes concurrency or consistency guarantees** for reservations or payments.
8. **Adopts a technology** listed under Future Decisions in `DECISIONS.md`.
9. **Removes or weakens a security control** (rate limiting, audit logging, input validation).
10. **Splits or extracts a microservice** from the modular monolith.

A new ADR is **not required** when:

* Implementing a documented design exactly as specified (e.g., Phase 2.1 migrations matching `DATABASE_SCHEMA.md`).
* Fixing a bug to restore documented behavior.
* Adding tests, logging, or observability that does not change contracts.
* Dependency patch/minor updates with no behavioral change (record in PR; security patches may need ADR if they change crypto parameters).

---

# ADR Lifecycle

```
Proposed → Review → Accepted → Implemented → (optional) Superseded
```

| Status | Meaning |
|---|---|
| **Proposed** | Draft; must not be implemented |
| **Accepted** | Approved; implementation may begin |
| **Deprecated** | Still in codebase; do not extend |
| **Replaced** | Superseded by newer ADR; old ADR remains for history |

### ADR content requirements

Every ADR must include: Context, Decision, Alternatives, Trade-offs, Consequences, Impact (affected documents and modules).

Numbering: sequential (`ADR-018`, `ADR-019`, …). Never reuse numbers.

---

# Documentation Update Policy

**Documentation leads implementation.** No feature ships with outdated docs.

## Mandatory updates by change type

| Change | Documents to update |
|---|---|
| New ADR | `DECISIONS.md`; all documents listed in ADR Impact section |
| Schema change | `DATABASE_SCHEMA.md` **before** Prisma migration |
| New domain rule | `DOMAIN_MODEL.md` |
| New event | `EVENTS.md` |
| New/changed endpoint | `API_GUIDELINES.md`; Swagger decorators in code |
| Auth change | `AUTHENTICATION_ARCHITECTURE.md` |
| Authz change | `AUTHORIZATION_ARCHITECTURE.md` |
| Tenancy change | `TENANCY.md`, `ARCHITECTURE.md` |
| New phase or milestone | `TASKS.md` (authoritative), then `PROJECT_ROADMAP.md`, `README.md` |
| Test approach change | `TESTING_STRATEGY.md` |
| Environment variable | `ENVIRONMENT_SETUP.md` |
| Lock scope change | `ARCHITECTURE_LOCK.md` |

## Documentation quality rules

* No contradictory terminology across documents (Authentication ≠ Authorization ≠ Tenancy).
* No duplicated specifications — cross-reference instead of copy-paste.
* Architecture documents describe **what** and **why**; `CODING_STANDARDS.md` describes **how** in code.
* Every significant decision must be traceable to an ADR or locked architecture document.

## PR documentation checklist

Every pull request must confirm:

- [ ] Relevant docs updated (or N/A stated with reason)
- [ ] ADR added if required
- [ ] `TASKS.md` updated if phase/milestone changes
- [ ] No conflict with `ARCHITECTURE_LOCK.md`

---

# Schema Evolution Rules

Schema changes are governed by **MIGRATION_POLICY.md**. Summary:

1. **`DATABASE_SCHEMA.md` is updated first** — it is the specification; Prisma schema follows.
2. **One concern per migration** when possible (easier review and rollback).
3. **No destructive changes in production** without expand-contract pattern and ADR.
4. **Seed data** for reference tables (Roles, Permissions) via seed scripts — not embedded in migrations.
5. **Indexes and constraints** documented in `DATABASE_SCHEMA.md` with rationale.
6. **New tables** must include `createdAt`, `updatedAt` unless documented exception.
7. **Soft delete** (`deletedAt`) where specified in domain rules.

Renaming a column in production requires: add new column → backfill → switch code → drop old column (minimum two releases for zero-downtime).

---

# API Change Rules

See **VERSIONING.md** for full rules. Summary:

* **Additive changes** (new optional field, new endpoint) → same `/api/v1`.
* **Breaking changes** (remove field, change semantics, rename) → new `/api/vN` or major version bump.
* Error codes are part of the contract — never reuse a code with different meaning.
* Deprecation: announce in release notes; maintain old behavior for at least one minor release before removal.

---

# Code Review Requirements

Every change requires pull request review before merge to `main`.

## Minimum reviewers

| Change type | Reviewers |
|---|---|
| Default | 1 approving reviewer (lead or delegate) |
| Architecture / ADR | Lead architect |
| Security (auth, authz, tenancy) | Lead architect + security-focused review |
| Schema migration | Lead architect or DBA delegate |
| Breaking API | Lead architect + API consumer notification plan |

Solo-maintainer exception: self-review permitted only for documentation typos; all code and migrations require a second pair of eyes when team size allows.

## Review checklist

Reviewers verify:

1. **Conforms to `ARCHITECTURE_LOCK.md`** — no silent architectural drift.
2. **ADR present** if required by this policy.
3. **Documentation updated** before or with the code.
4. **Tests** per `TESTING_STRATEGY.md` (unit for domain/use cases; integration for repositories; E2E for critical flows).
5. **No business logic in controllers** or Prisma repositories.
6. **No secrets** in code, logs, or commits.
7. **Tenant scoping** not bypassed without audited system context.
8. **Migrations** reviewed for reversibility and production safety (`MIGRATION_POLICY.md`).
9. **Lint and typecheck** pass (`pnpm lint`, `tsc --noEmit`).
10. **Conventional Commits** message format.

## Automated gates (when CI is active)

* ESLint — zero warnings
* TypeScript — no errors
* Unit tests — pass
* Integration tests — pass (Docker stack)
* `pnpm audit` — no critical vulnerabilities

---

# Breaking Change Definition

A change is **breaking** if it:

* Removes or renames a public API field or endpoint.
* Changes HTTP status code for an existing success/error case.
* Changes authentication or authorization requirements for an existing endpoint.
* Requires clients to send new mandatory fields.
* Alters event payload shape consumed by other modules or clients.
* Requires a database migration that cannot run without downtime (without expand-contract).
* Changes default behavior of an existing feature.

Breaking changes require: ADR (if architectural), API version strategy, migration plan, and release notes per `RELEASE_POLICY.md`.

---

# Emergency Changes

Production incidents may require immediate hotfix on `hotfix/*` branch (see `BRANCHING_STRATEGY.md`).

Post-incident requirements (within 48 hours):

1. Retrospective ADR if locked architecture was touched.
2. Documentation update if behavior differs from docs.
3. Test added to prevent recurrence.

---

# Related Documents

| Document | Relationship |
|---|---|
| `ARCHITECTURE_LOCK.md` | What cannot change without ADR |
| `MIGRATION_POLICY.md` | Database change mechanics |
| `VERSIONING.md` | API and package versioning |
| `RELEASE_POLICY.md` | Release and deployment gates |
| `BRANCHING_STRATEGY.md` | Git workflow |
| `DECISIONS.md` | ADR log |
