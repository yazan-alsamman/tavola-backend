# RELEASE_POLICY.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

Defines how platform releases are planned, validated, tagged, and deployed. Applies from Phase 2.1 onward.

---

# Release Types

| Type | Branch | Version bump | When |
|---|---|---|---|
| **Phase release** | `main` | MINOR (`0.x.0`) | Phase exit criteria met (e.g., Phase 2 complete) |
| **Patch release** | `main` or `hotfix/*` | PATCH (`0.x.y`) | Bug/security fix |
| **Pre-release** | `main` | `0.x.y-rc.N` (optional) | Staging validation before production |
| **Hotfix** | `hotfix/*` | PATCH | Production incident |
| **Major release** | `main` | MAJOR (`1.0.0+`) | Production launch or breaking platform change |

Current stage: **pre-1.0** (`0.0.0`). First phase release target: **`0.2.0`** upon Phase 2 completion.

---

# Environments

| Environment | Purpose | Migration | Deploy trigger |
|---|---|---|---|
| **Local** | Developer workstation | `migrate dev` | Manual |
| **CI** | Automated tests | `migrate deploy` | Every PR to `main` (when CI active) |
| **Staging** | Pre-production validation | `migrate deploy` | Merge to `main` |
| **Production** | Live traffic | `migrate deploy` | Tagged release + approval |

Configuration per `ENVIRONMENT_SETUP.md`.

---

# Release Workflow

```
Feature complete → PR to main → CI green → Staging deploy → Validation → Tag → Production (when applicable)
```

## Standard release (phase or minor)

### 1. Pre-release checklist

- [ ] Phase tasks in `TASKS.md` marked complete for scope
- [ ] All tests pass (`pnpm lint`, `pnpm backend:typecheck`, `pnpm backend:test`, E2E if applicable)
- [ ] `pnpm audit` — no critical vulnerabilities
- [ ] Documentation updated per `CHANGE_POLICY.md`
- [ ] Migrations applied on staging without error
- [ ] No open P0/P1 defects for release scope
- [ ] `ARCHITECTURE_LOCK.md` compliance verified

### 2. Version bump

* Update `package.json` and `apps/backend/package.json` version.
* Update `CHANGELOG.md` (when introduced) or release notes in GitHub Release.

### 3. Git tag

```bash
git tag -a v0.2.0 -m "Phase 2: Authentication & Authorization"
git push origin v0.2.0
```

Tag format: `v{MAJOR}.{MINOR}.{PATCH}` per `VERSIONING.md`.

### 4. Staging validation

* Smoke test: health, metrics, auth flows (when implemented).
* Migration idempotency: `migrate deploy` on staging DB with prior version applied.
* Rollback plan documented if migration included.

### 5. Production deploy (when production exists)

* Backup database before migration.
* `prisma migrate deploy`
* Deploy container image (Docker Compose / orchestrator).
* Post-deploy smoke test.
* Monitor logs and metrics for 30 minutes.

### 6. Post-release

* Update `TASKS.md` / `PROJECT_ROADMAP.md` status.
* Announce breaking changes and deprecations.
* Close release milestone.

---

# Phase Gate Releases

Each phase may produce one MINOR release when exit criteria are met:

| Phase | Target version | Exit criteria (summary) |
|---|---|---|
| Phase 1 | `0.1.0` | Infrastructure verified (complete) |
| Phase 2 | `0.2.0` | Auth + authz tested (unit + integration + E2E) |
| Phase 7 | `0.7.0` | Reservation engine + conflict tests |
| Phase 15 | `1.0.0` | Production readiness review |

Exact checklists live in `TASKS.md` and `PROJECT_ROADMAP.md`.

---

# Hotfix Workflow

For production incidents:

1. Branch `hotfix/{short-description}` from latest production tag.
2. Minimal fix only — no unrelated changes.
3. Expedited review (security/architecture if touching locked areas).
4. Deploy to staging → production.
5. Merge hotfix back to `main`.
6. PATCH version bump and tag.
7. Retrospective ADR within 48h if locked architecture touched.

---

# Database Release Coordination

Migrations and application code deploy together unless using expand-contract:

| Migration type | Deploy strategy |
|---|---|
| Additive only | Migration before or with code — either order safe |
| Expand-contract | Migration (expand) → deploy code → later migration (contract) |
| Destructive | Maintenance window + ADR + backup |

See `MIGRATION_POLICY.md`.

---

# Release Artifacts

| Artifact | Location / tool |
|---|---|
| Container image | Docker build from `apps/backend/Dockerfile` |
| Migration SQL | `apps/backend/prisma/migrations/` |
| OpenAPI spec | `/api/v1/docs` (export when CI added) |
| Git tag | `v*.*.*` |
| Release notes | GitHub Releases (when remote configured) |

---

# Rollback Policy

| Component | Rollback method |
|---|---|
| **Application** | Redeploy previous container image / tag |
| **Database** | Forward-fix migration preferred; restore from backup as last resort |
| **Configuration** | Revert env vars; redeploy |

Never `git revert` an already-applied production migration — apply a forward migration instead.

---

# Release Approval

| Environment | Approver |
|---|---|
| Staging | Any merge to `main` (CI gate) |
| Production | Lead architect or designated release manager |
| Hotfix | Lead architect (or delegate) + incident commander |

Pre-1.0: production approval not required until production environment exists.

---

# Communication

Release notes must include:

* Version number and date
* Phase or feature summary
* **Breaking changes** (if any)
* **API deprecations**
* **Migration notes** (manual steps, downtime)
* **Configuration changes** (new env vars)

---

# CI/CD Status

CI/CD pipeline is not yet implemented (tracked in `DECISIONS.md` Future Decisions). Until CI is active:

* Manual execution of verification commands before every merge to `main`.
* Release checklist is mandatory manual gate.

When CI is adopted, an ADR will define pipeline stages; this policy's gates become automated required checks.

---

# Related Documents

| Document | Relationship |
|---|---|
| `VERSIONING.md` | Version numbering rules |
| `BRANCHING_STRATEGY.md` | Branch and merge workflow |
| `MIGRATION_POLICY.md` | Database deploy rules |
| `CHANGE_POLICY.md` | Review requirements |
| `TESTING_STRATEGY.md` | Test gates |
| `TASKS.md` | Phase exit criteria |
