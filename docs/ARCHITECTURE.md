# ARCHITECTURE

## Enterprise Restaurant Reservation Platform

Version: 1.0

---

# System Overview

This platform is an enterprise-grade multi-tenant SaaS solution that enables restaurants to manage reservations, tables, branches, staff, customers, menus, offers, subscriptions, analytics, and notifications from a centralized backend.

The system is designed for high availability, horizontal scalability, and long-term maintainability.

Primary clients:

* Flutter Mobile Application (Customer)
* Next.js Dashboard (Restaurant)
* Admin Dashboard
* Public REST API

---

# Architectural Principles

The backend follows:

* Clean Architecture
* Domain Driven Design (DDD)
* SOLID Principles
* Repository Pattern
* Dependency Injection
* Modular Monolith (Microservice-ready)
* API First
* Security by Design

---

# High-Level Architecture

Client Applications

↓

Nginx

↓

NestJS API

↓

Application Layer

↓

Domain Layer

↓

Infrastructure Layer

↓

PostgreSQL / Redis / MinIO / OneSignal / BullMQ

---

# Layers

## Presentation Layer

Responsibilities

* REST Controllers
* WebSocket Gateway
* Request Validation
* DTO Mapping
* Authentication
* Authorization

Contains

* Controllers
* DTOs
* Guards
* Pipes
* Interceptors

---

## Application Layer

Contains business use cases.

Examples

* Create Reservation
* Approve Reservation
* Reject Reservation
* Create Restaurant
* Upload Image

Responsibilities

* Orchestrate business logic
* Call repositories
* Publish domain events

### CQRS Readiness

The application layer follows a **command/query split** without a separate CQRS framework:

| Pattern | Implementation |
|---|---|
| **Commands** | Use cases that mutate state (`CreateReservation`, `ApproveReservation`, …) — single transaction, emit domain events |
| **Queries** | Read-only use cases (`SearchRestaurants`, `GetDashboardActivity`, …) — no side effects |
| **Read models** | Denormalized projections populated asynchronously (`ActivityFeed` via BullMQ from domain events) |
| **Future extraction** | Command handlers and query handlers can move to separate services without API contract changes |

Full event-sourcing is **not** adopted; `ReservationHistory` and `AuditLogs` provide audit trails.

---

## Domain Layer

Contains

* Entities
* Value Objects
* Domain Services
* Interfaces
* Business Rules

No framework dependencies are allowed.

---

## Infrastructure Layer

Contains

* Prisma
* Redis
* OneSignal
* BullMQ
* MinIO
* External APIs
* Repositories

Only this layer communicates with external systems.

---

# Feature Modules

Authentication

Authorization

Organizations

Users

Restaurants

Branches

Employees

Roles

Permissions

Tables

Reservations

Reviews

Menus

Offers

Notifications

Subscriptions

Payments

Analytics

Files

Audit Logs

Settings

Each feature owns:

* Controller
* Service
* Repository
* DTOs
* Entities
* Validators
* Tests

---

# Multi-Tenant Strategy

The application is logically multi-tenant. The **Organization** is the tenant boundary (see ADR-011 in DECISIONS.md and DOMAIN_MODEL.md) — a Restaurant belongs to exactly one Organization, and an Organization may own one or more Restaurants.

Every request contains the authenticated tenant context (`organizationId`), established immediately after authentication and propagated via async context for the lifetime of the request or WebSocket connection.

Every database query against a tenant-owned model is automatically scoped by `organizationId` through a Prisma Client Extension — this is a structural guarantee, not a per-query convention. Branch- and Restaurant-level scoping within a tenant is a separate **authorization** concern handled by `PermissionResolver`, scope guards, and domain policies (see AUTHORIZATION_ARCHITECTURE.md and DOMAIN_MODEL.md Employee Branch Rules).

Cross-tenant access is strictly prohibited except through an explicitly named, audited system-context client reserved for platform administration.

The full mechanism (async context propagation, the Prisma Client Extension, the system-context escape hatch, and testing requirements) is defined in **TENANCY.md** and ADR-012 — this section states the principle; those documents define the enforcement.

---

# Data Flow

Client Request

↓

Authentication

↓

Authorization

↓

Validation

↓

Use Case

↓

Repository

↓

Database

↓

Response DTO

---

# Realtime Architecture

Socket.IO handles:

* Reservation updates
* Table status changes
* Notifications
* Dashboard synchronization

Realtime communication is event-driven.

Socket.IO runs behind the Redis Adapter (`@socket.io/redis-adapter`) so that broadcasts propagate correctly across every horizontally-scaled, stateless API instance — not only to clients connected to the same process that triggered the event. This is required infrastructure, not an optimization: without it, a REST action handled by instance A would never reach a WebSocket client connected to instance B. See ADR-015 for the full architecture, room-authorization model, and the rationale for choosing Redis pub/sub over a dedicated message broker for this purpose.

---

# Notification Architecture

Notification Service

↓

Notification Provider Interface

↓

OneSignal Provider

Future providers:

* APNs
* Huawei Push
* Email
* SMS

The application never depends directly on a specific provider.

Notification content is resolved through a `NotificationTemplate`, keyed by event type, channel, and the recipient's locale, before being handed to the Notification Provider Interface — see LOCALIZATION.md for the resolution/fallback rules.

---

# Background Processing

BullMQ handles:

* Reservation reminders
* Notification delivery
* Report generation
* Cleanup jobs
* Expiration jobs

Workers must remain stateless.

---

# Storage

MinIO stores:

* Images
* Documents
* Menus
* Profile Pictures

Signed URLs must be generated for secure access.

---

# Database Strategy

PostgreSQL is the source of truth.

Redis is used only for:

* Cache
* Sessions
* Locks
* Queues
* Temporary data

Persistent business data must never be stored exclusively in Redis.

---

# Error Handling

Global Exception Filter

Standard error response format

Correlation ID for tracing

Structured logging

---

# Scalability Strategy

Stateless API servers

Horizontal scaling

Redis-backed queues

Database indexing

Caching

Connection pooling

Read replicas (future)

---

# Security

JWT Authentication — see **AUTHENTICATION_ARCHITECTURE.md** and ADR-016

Authorization (RBAC, policies, scope guards) — see **AUTHORIZATION_ARCHITECTURE.md** and ADR-017

Refresh Tokens (opaque, rotated, token families)

Session Version (global logout-all)

Argon2 Password Hashing

Rate Limiting

Audit Logs

Secure File Uploads

Input Validation

Environment Variables

Security Headers

---

# Future Expansion

The architecture is intentionally designed to support future migration toward microservices without requiring major refactoring.

Potential future services include:

* Reservation Service
* Notification Service
* Payment Service
* Analytics Service
* Search Service
* Organization & Tenancy Service
