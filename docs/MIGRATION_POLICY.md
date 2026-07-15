# MIGRATION_POLICY.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

Defines rules for Prisma database migrations from Phase 2.1 onward. Ensures schema evolution is safe, reviewable, reversible where possible, and consistent with `DATABASE_SCHEMA.md`.

---

# Principles

1. **`DATABASE_SCHEMA.md` is the specification** — update it before writing Prisma schema or migrations.
2. **Migrations are versioned artifacts** — committed to git; never applied manually in production.
3. **Forward-only in production** — `prisma migrate deploy`; never `migrate dev` or `db push` against production.
4. **Reversible where possible** — every migration should have a documented rollback strategy.
5. **Zero-downtime by default** — use expand-contract for breaking column changes.
6. **Seed ≠ migrate** — reference data via seed scripts; structural changes via migrations only.

---

# Migration Workflow

## Development

```
1. Update DATABASE_SCHEMA.md
2. Update prisma/schema.prisma to match
3. Run: pnpm --filter backend prisma:migrate:dev --name <descriptive_name>
4. Review generated SQL in prisma/migrations/<timestamp>_<name>/migration.sql
5. Run integration tests against migrated database
6. Commit: schema.prisma + migration SQL + doc updates
```

## CI / Staging / Production

```
prisma migrate deploy
```

Never use `prisma db push` in shared or production environments.

---

# Naming Conventions

| Item | Convention | Example |
|---|---|---|
| Migration folder | `YYYYMMDDHHMMSS_snake_case_description` | `20260707120000_add_auth_tables` |
| Migration name (`--name`) | `verb_noun_context` | `add_token_families` |
| Prisma model | PascalCase singular | `DeviceSession` |
| Table (`@@map`) | snake_case plural | `device_sessions` |
| Column | camelCase in Prisma, snake_case in DB | `sessionVersion` → `session_version` |

One migration should represent **one logical change** (e.g., "add authentication tables", not "add auth and reservation tables").

---

# Phase 2.1 — First Business Migration

The first business migration (Phase 2.1) establishes authentication and authorization tables per locked architecture.

### Expected scope

* Extend `Users` (`sessionVersion`, `permissionsVersion`, auth fields)
* `DeviceSessions`, `TokenFamilies`
* `EmailVerificationTokens`, `PasswordResetTokens`, `PasswordHistory`, `LoginAttempts`
* `Roles`, `Permissions`, `RolePermissions` (if not present)
* `PlatformAdmins`
* Indexes and FKs per `DATABASE_SCHEMA.md`

### Explicitly excluded from Phase 2.1

* `PermissionAssignments` (Phase 3+)
* `Reservations` exclusion constraint / `btree_gist` (Phase 7 — but extension enablement may be planned)
* Business entities not required for auth (Menus, Offers, etc.) unless already specified

### Phase 2.1 rules

1. Migration must match `DATABASE_SCHEMA.md` field-for-field.
2. No placeholder columns or undocumented tables.
3. Integration test: migration applies cleanly on empty database and on Phase 1 `SystemConfiguration`-only database.
4. Seed script (Phase 2.2) is separate from migration SQL.

---

# Migration Content Rules

## Required in every migration

* Structural DDL only (CREATE, ALTER, INDEX, CONSTRAINT).
* Comments in SQL when non-obvious (e.g., partial unique indexes).

## Forbidden in migrations

* `INSERT` / `UPDATE` of business or reference data (use seeds).
* `DROP TABLE` / `DROP COLUMN` on first introduction of a table (only in later cleanup migrations with ADR).
* Manual data fixes without ADR and runbook.
* Environment-specific logic (no `IF current_database() = ...` hacks).

## Extensions

PostgreSQL extensions must be enabled in a dedicated migration before dependent objects:

```sql
CREATE EXTENSION IF NOT EXISTS btree_gist;
```

Required before `Reservations` exclusion constraint (ADR-013). Document in `ENVIRONMENT_SETUP.md`.

---

# Safe Schema Evolution Patterns

## Additive (preferred)

| Change | Pattern |
|---|---|
| New table | `CREATE TABLE` — safe |
| New nullable column | `ALTER TABLE ADD COLUMN` — safe |
| New index | `CREATE INDEX CONCURRENTLY` in production (document if Prisma wraps non-concurrent) |
| New FK (nullable) | Add column → backfill → add constraint |

## Destructive (requires ADR + expand-contract)

| Change | Pattern |
|---|---|
| Rename column | Add new → backfill → dual-write → switch reads → switch writes → drop old |
| Change column type | Same as rename; never in-place cast on large tables without plan |
| NOT NULL on existing column | Add nullable → backfill → set NOT NULL |
| Drop column | Deprecate in code first → deploy → drop in later migration |
| Drop table | Soft-delete period → archive → ADR → drop |

## Constraint changes

* Adding UNIQUE or FK: verify no violating rows in staging first.
* Exclusion constraints: test with concurrent insert integration tests (ADR-013).

---

# Rollback Strategy

Prisma does not auto-generate down migrations. Each migration PR must document:

| Section | Content |
|---|---|
| **Forward** | What the migration does |
| **Rollback** | SQL or steps to undo (if feasible) |
| **Data impact** | Whether rollback loses data |
| **Downtime** | Expected lock duration |

### Rollback tiers

| Tier | When | Action |
|---|---|---|
| **1 — Reversible** | Additive only | `DROP` new objects in reverse order |
| **2 — Forward-fix** | Column rename/type change | New migration to restore; don't revert git |
| **3 — Irreversible** | Data truncation, hard delete | Restore from backup; ADR required |

Production rollback default: **forward-fix** (new migration), not git revert of applied migrations.

---

# Multi-Environment Rules

| Environment | Migration command | Notes |
|---|---|---|
| Local | `prisma migrate dev` | Developer machine; may reset freely |
| CI | `prisma migrate deploy` | Fresh or persistent test DB |
| Staging | `prisma migrate deploy` | Mirrors production process |
| Production | `prisma migrate deploy` | Manual approval gate; backup before apply |

### Pre-production checklist

- [ ] Migration reviewed (SQL inspected)
- [ ] `DATABASE_SCHEMA.md` in sync
- [ ] Integration tests pass
- [ ] Staging applied successfully
- [ ] Backup verified (production only)
- [ ] Rollback plan documented in PR

---

# Seed Policy

| Data type | Mechanism |
|---|---|
| Roles, Permissions, RolePermissions | `prisma/seed.ts` (Phase 2.2) |
| SystemConfiguration defaults | Seed script |
| Country, Currency reference | Seed script (when introduced) |
| Test fixtures | Test factories — not seeds |
| Production tenant data | API / admin tools — never seeds |

Seeds must be **idempotent** (`upsert` or existence checks).

---

# Prisma Schema Rules

* `schema.prisma` must match `DATABASE_SCHEMA.md` — discrepancies are defects.
* Use `@@map` and `@map` for snake_case database columns.
* UUID primary keys: `@default(uuid())` or `@db.Uuid`.
* Timestamps: `createdAt DateTime @default(now())`, `updatedAt DateTime @updatedAt`.
* Soft delete: `deletedAt DateTime?` where specified.
* Relations: explicit `onDelete` behavior documented in `DATABASE_SCHEMA.md`.

---

# Lock Interaction

Migrations must not implement schema that contradicts `ARCHITECTURE_LOCK.md`. If a migration requires architectural change, stop — unlock via `CHANGE_POLICY.md` first.

---

# Related Documents

| Document | Relationship |
|---|---|
| `DATABASE_SCHEMA.md` | Table specification (source of truth) |
| `ARCHITECTURE_LOCK.md` | Locked schema decisions |
| `CHANGE_POLICY.md` | When schema changes need ADR |
| `RELEASE_POLICY.md` | Production migration gate |
| `ENVIRONMENT_SETUP.md` | Database connection and extensions |
