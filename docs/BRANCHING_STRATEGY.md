# BRANCHING_STRATEGY.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

Defines Git branching, naming, merge rules, and commit conventions. Supports architecture governance and phase-based delivery from Phase 2.1 onward.

---

# Branch Model

**Trunk-based development with a protected `main` branch** and short-lived topic branches.

```
main (protected, always deployable)
  ↑
  ├── feature/phase-2.1-auth-migrations
  ├── feature/phase-2.5-login-use-case
  ├── fix/session-version-guard-null-check
  └── hotfix/token-replay-race-condition
```

No long-lived `develop` branch — `main` is the integration trunk.

---

# Permanent Branches

| Branch | Purpose | Protection |
|---|---|---|
| `main` | Production-ready code; all releases tagged from here | Protected: PR required, CI must pass (when active), no force-push |

---

# Topic Branches

| Pattern | Purpose | Base | Merge target | Max lifetime |
|---|---|---|---|---|
| `feature/{description}` | New functionality | `main` | `main` | ≤ 2 weeks |
| `fix/{description}` | Non-urgent bug fixes | `main` | `main` | ≤ 1 week |
| `hotfix/{description}` | Production emergencies | Latest production **tag** | `main` + tag | ≤ 48 hours |
| `docs/{description}` | Documentation-only | `main` | `main` | ≤ 1 week |

### Naming rules

* Lowercase kebab-case.
* Include phase context when helpful: `feature/phase-2.1-auth-migrations`.
* Descriptive — not `feature/wip` or `fix/stuff`.

### Examples

```
feature/phase-2.1-auth-migrations
feature/phase-2.13-permission-resolver
fix/device-session-expiry-timezone
docs/phase-2.0.2-governance
hotfix/refresh-token-reuse-detection
```

---

# Workflow

## Feature / fix development

```
1. git checkout main && git pull
2. git checkout -b feature/phase-2.1-auth-migrations
3. Implement (conform to ARCHITECTURE_LOCK.md)
4. Push branch; open Pull Request to main
5. Code review per CHANGE_POLICY.md
6. CI passes (when active)
7. Squash merge or merge commit (team preference: squash for clean history)
8. Delete topic branch after merge
```

## Hotfix

```
1. git checkout v0.2.0  # latest production tag
2. git checkout -b hotfix/critical-fix
3. Fix + test
4. PR to main (expedited review)
5. Tag v0.2.1 after merge
6. Deploy production
```

---

# Pull Request Rules

| Rule | Requirement |
|---|---|
| Target branch | `main` only (except hotfix cherry-pick) |
| Size | Prefer < 400 lines changed; split large phases into incremental PRs |
| Description | What, why, how to test, migration notes |
| Linked docs | ADR number or doc updates listed |
| Tests | Required per `TESTING_STRATEGY.md` |
| Approvals | Per `CHANGE_POLICY.md` |
| Draft PRs | Encouraged for early feedback on large work |

### PR title format

Use Conventional Commits prefix:

```
feat(auth): add device session repository
fix(tenancy): reject missing organizationId claim
docs: add migration policy
```

---

# Commit Convention

**[Conventional Commits 1.0.0](https://www.conventionalcommits.org/)** — required.

```
<type>(<scope>): <description>

[optional body]

[optional footer: BREAKING CHANGE:, Refs ADR-018]
```

### Types

| Type | Use |
|---|---|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change without feature/fix |
| `test` | Tests only |
| `chore` | Build, deps, tooling |
| `perf` | Performance improvement |
| `ci` | CI configuration |
| `build` | Build system |
| `revert` | Revert prior commit |

### Scopes (examples)

`auth`, `authz`, `tenancy`, `reservation`, `prisma`, `docker`, `deps`

### Breaking changes

```
feat(api)!: remove deprecated /auth/legacy-login endpoint

BREAKING CHANGE: legacy login removed; use POST /api/v1/auth/login
```

Breaking commits require API version strategy per `VERSIONING.md`.

---

# Merge Strategy

| Strategy | When |
|---|---|
| **Squash merge** | Default for feature/fix branches — one commit per PR on `main` |
| **Merge commit** | Phase completion PRs when preserving full branch history is valuable |
| **Rebase** | Allowed on topic branch before PR (keep branch current with `main`) |

### Forbidden on `main`

* Force push (`git push --force`)
* Direct commits without PR (except automated release bots when configured)
* Merge with failing CI
* Skip hooks (`--no-verify`) unless explicitly approved for emergency

---

# Release Branches (Optional — Post 1.0)

When production clients require stabilization periods, optional `release/{version}` branches may be cut from `main`:

* Only bug fixes cherry-picked from `main`.
* Tagged as `v1.0.0`, `v1.0.1`, etc.
* Merged back to `main` after release.

Not used during pre-1.0 phase development.

---

# Tagging

| Tag pattern | Meaning |
|---|---|
| `v0.2.0` | Release per `RELEASE_POLICY.md` |
| `v0.2.0-rc.1` | Release candidate (optional) |

Tags are **annotated** and pushed to origin:

```bash
git tag -a v0.2.0 -m "Phase 2 complete"
git push origin v0.2.0
```

---

# Phase 2.1 Branch Guidance

Recommended sequence for Phase 2.1:

| PR | Branch | Scope |
|---|---|---|
| 1 | `feature/phase-2.1-auth-migrations` | Prisma schema + migration SQL only |
| 2 | `feature/phase-2.2-auth-seed` | Seed: Roles, Permissions, SystemConfiguration |
| 3+ | `feature/phase-2.x-...` | Per AUTHENTICATION_ARCHITECTURE.md implementation plan |

One migration concern per PR when possible (`MIGRATION_POLICY.md`).

---

# Fork and Clone Notes

Git repository root may differ from project workspace path. Always verify:

```bash
git rev-parse --show-toplevel
```

Commits for TAVLA must land in the correct repository remote.

---

# Related Documents

| Document | Relationship |
|---|---|
| `RELEASE_POLICY.md` | Tagging and deploy after merge |
| `CHANGE_POLICY.md` | Review requirements |
| `ARCHITECTURE_LOCK.md` | Conformance during development |
| `TASKS.md` | Phase sequencing |
