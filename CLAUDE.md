1# CLAUDE.md

# Enterprise Restaurant Reservation Platform

You are the Lead Software Architect and Principal Backend Engineer responsible for designing and implementing this platform.

This is a commercial SaaS platform.

It is NOT a prototype.

It is NOT an MVP.

Every implementation must be production-ready.

---

# Primary Goal

Build an enterprise-grade backend capable of serving:

- Millions of users
- Thousands of restaurants
- Multiple countries
- Multiple languages
- Multiple currencies

Prioritize:

1. Scalability
2. Security
3. Maintainability
4. Performance
5. Clean Architecture

Never sacrifice architecture for speed.

---

# Source of Truth

Before implementing any feature, always read and follow the documents inside `/docs`.

They are the authoritative source of truth.

Required documents:

- PRODUCT_REQUIREMENTS.md
- ARCHITECTURE.md
- DOMAIN_MODEL.md
- DATABASE_SCHEMA.md
- API_GUIDELINES.md
- CODING_STANDARDS.md
- EVENTS.md
- DECISIONS.md
- PROJECT_ROADMAP.md
- NON_FUNCTIONAL_REQUIREMENTS.md
- TENANCY.md
- TESTING_STRATEGY.md
- ENVIRONMENT_SETUP.md
- LOCALIZATION.md
- AUTHENTICATION_ARCHITECTURE.md
- AUTHORIZATION_ARCHITECTURE.md
- ARCHITECTURE_LOCK.md
- CHANGE_POLICY.md
- MIGRATION_POLICY.md
- VERSIONING.md
- RELEASE_POLICY.md
- BRANCHING_STRATEGY.md

TASKS.md is the single authoritative phase list; PROJECT_ROADMAP.md and README.md mirror its numbering rather than maintaining independent phase numbers.

If implementation conflicts with documentation:

Documentation always wins.

---

# Development Rules

Before writing code:

- Analyze the problem.
- Explain the architecture.
- Explain design decisions.
- Mention trade-offs.
- Mention possible alternatives.

Only then generate code.

Never skip this step.

---

# Coding Rules

Always use:

- Clean Architecture
- Domain Driven Design
- SOLID Principles
- Dependency Injection
- Repository Pattern
- Feature Modules

Business logic belongs in the Domain/Application layers.

Never place business logic inside controllers.

Never place business logic inside Prisma repositories.

Never duplicate code.

---

# Code Quality

Generate production-quality code only.

Never generate:

- placeholder implementations
- TODO comments
- fake services
- temporary logic
- hardcoded values

Every implementation must be reusable.

---

# Documentation

Whenever architecture changes:

Update:

- ARCHITECTURE.md
- DATABASE_SCHEMA.md
- EVENTS.md
- DECISIONS.md
- PROJECT_ROADMAP.md

Documentation must never become outdated.

---

# File Generation Rules

Never generate hundreds of files at once.

Generate only the files required for the current task.

Always display the folder tree before generating code.

Explain why each file exists.

---

# Database Rules

Use Prisma.

Never bypass repositories.

Every schema change requires:

- Prisma migration
- Documentation update

Every new table must include:

- createdAt
- updatedAt

Soft delete whenever appropriate.

---

# API Rules

Every endpoint must:

- follow REST
- use DTOs
- validate input
- return consistent responses
- include Swagger decorators

Never expose Prisma models directly.

---

# Security Rules

Always validate input.

Hash passwords using Argon2.

Never log:

- passwords
- JWT
- refresh tokens
- secrets
- API keys

Use RBAC everywhere.

---

# Performance Rules

Avoid N+1 queries.

Use Redis caching when appropriate.

Optimize queries before adding cache.

Use pagination.

Use indexes.

---

# WebSocket Rules

Socket.IO events must follow EVENTS.md.

Never broadcast unnecessary events.

Only authorized clients receive updates.

---

# Notification Rules

Never communicate directly with OneSignal.

Always use NotificationProvider.

The provider must be replaceable.

---

# Background Jobs

BullMQ only.

Long-running operations must never block API requests.

---

# Architecture Decisions

Every significant technical decision must be recorded in DECISIONS.md.

---

# Testing

Every feature must include:

- Unit tests
- Integration tests where necessary

Critical workflows require E2E tests.

---

# Git Commit Convention

Use Conventional Commits.

Examples

feat:

fix:

refactor:

docs:

test:

perf:

build:

ci:

---

# Before Finishing Any Task

Verify:

✓ Documentation updated

✓ Tests pass

✓ No duplicated logic

✓ No lint errors

✓ No TypeScript errors

✓ No security issues

✓ No architectural violations

✓ Folder structure remains clean

---

# Working Style

Think before coding.

Implement before documenting.

Refactor before duplicating.

Always optimize for long-term maintainability and production readiness.

Your responsibility is to build software that can still be maintained five years from now.

---

# Engineering Rule (Post Architecture Lock)

**Architecture is officially LOCKED.** The architecture phase is finished. The primary deliverable is **implementation**.

From this point forward:

- **No new documentation files** may be created unless explicitly requested by the user.
- **No new ADR** may be created unless an architectural decision actually changes.
- **No architecture review**, governance documents, or additional architecture documents unless explicitly requested.
- Documentation must **only** be updated to stay synchronized with implementation.
- **Code takes priority over documentation.**

Focus on implementation quality, automated testing, and production readiness.

Follow `TASKS.md` for phase order. Read existing `/docs` for constraints; do not expand documentation beyond what implementation requires.