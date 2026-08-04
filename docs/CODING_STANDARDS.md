# CODING STANDARDS

## General Principles

Code must be:

* Readable
* Maintainable
* Testable
* Consistent
* Modular

Optimize for long-term maintenance rather than short-term speed.

---

# TypeScript

Enable strict mode.

Avoid using:

* any
* unknown (unless justified)
* type assertions without validation

Prefer interfaces for contracts and types for utility compositions.

---

# Naming

Classes

PascalCase

Services

ReservationService

Controllers

ReservationController

Repositories

ReservationRepository

Interfaces

Prefix with I only if required by the project convention.

Variables

camelCase

Constants

UPPER_SNAKE_CASE

Enums

PascalCase

Files

kebab-case

---

# Functions

Each function should perform one responsibility.

Avoid functions longer than approximately 50 lines unless justified by complexity.

Extract reusable logic into services or utility classes.

---

# Controllers

Controllers should contain no business logic.

Controllers only:

* Validate requests
* Call services
* Return responses

---

# Services

Services implement business rules.

Services must not directly access Prisma unless they are infrastructure repositories.

---

# Repositories

Repositories encapsulate database access.

Business logic must never be placed inside repositories.

Repositories always use the injected, tenant-scoped Prisma client (see TENANCY.md, ADR-012). Two named exceptions exist, formalized by ADR-035 (2026-08-04, correcting this section's prior reference to an unimplemented `prisma.$systemContext`): **Pattern 1, Explicit Tenant Rebind** (a PlatformAdmin use case manually rebinds Tenant Context to a caller-supplied target tenant, then calls the ordinary tenant-scoped repository unchanged — no repository-level exception at all) and **Pattern 2, Tenant-Agnostic Raw Reader** (a dedicated reader class injects the raw `PrismaService` directly, for genuinely cross-tenant reads with no single tenant identity — restricted to files explicitly listed in `.eslintrc.js`'s `no-restricted-imports` `excludedFiles` whitelist). Pattern 2 must never be used inside an ordinary feature-module repository outside that whitelist, and any addition to the whitelist must be justified with a doc comment on the class itself, per TENANCY.md.

---

# Transactions and Concurrency

Any database transaction that acquires a PostgreSQL advisory lock (see ADR-013, used by the Reservation Engine) must contain **only** database statements — no external I/O (notification dispatch, file storage calls) may occur inside that transaction. External side effects are triggered via a BullMQ job published only after the transaction commits. This keeps locked transactions short-lived and prevents a slow external call from holding a contended lock.

BullMQ job handlers must explicitly establish Tenant Context (see TENANCY.md) from the job's payload as the first line of the handler, since jobs have no inbound HTTP/WebSocket request to derive it from automatically. Job payloads must always include `organizationId` explicitly.

---

# Dependency Injection

Always use dependency injection.

Avoid manually instantiating services.

---

# Validation

Validate all incoming data.

Fail fast.

Return meaningful error messages.

---

# Logging

Use structured logging.

Never log:

Passwords

Tokens

Secrets

Personal sensitive information

---

# Comments

Write self-documenting code.

Only comment:

Complex algorithms

Business rules

Architectural decisions

Avoid redundant comments.

---

# Testing

Every service should have unit tests.

Critical workflows require integration tests.

Reservation engine requires end-to-end tests.

---

# Error Handling

Throw domain-specific exceptions.

Avoid generic Error objects.

---

# Security

Never hardcode:

Secrets

API keys

Database credentials

Use environment variables exclusively.

---

# Performance

Avoid unnecessary database queries.

Use eager loading only when justified.

Use indexes appropriately.

Cache expensive operations.

---

# Git

Commit format:

feat:

fix:

refactor:

test:

docs:

perf:

ci:

build:

chore:

Follow Conventional Commits.

---

# Pull Requests

Every pull request should include:

Purpose

Implementation summary

Testing notes

Breaking changes

Documentation updates

---

# Documentation

Every public class and exported module should have a clear purpose.

Architectural changes must be reflected in ARCHITECTURE.md and DECISIONS.md.

---

# Quality Gates

Before merging:

* All tests pass.
* No lint errors.
* No TypeScript errors.
* Swagger documentation updated.
* Database migrations reviewed.
* Documentation synchronized.
* Security implications considered.

No feature is considered complete until these quality gates are satisfied.
