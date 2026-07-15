# NON_FUNCTIONAL_REQUIREMENTS.md

# Enterprise Restaurant Reservation Platform

Version: **1.0**

Document Status: **Approved**

---

# Purpose

This document defines the non-functional requirements (NFRs) for the Enterprise Restaurant Reservation Platform.

Unlike functional requirements, these requirements describe **how the system must behave** rather than **what the system must do**.

These requirements are mandatory and apply to every module, service, API endpoint, and deployment environment.

---

# Quality Attributes

The platform is designed around the following priorities:

1. Availability
2. Reliability
3. Security
4. Performance
5. Scalability
6. Maintainability
7. Observability
8. Recoverability
9. Extensibility

No implementation may compromise these attributes without an approved Architecture Decision Record (ADR).

---

# Performance Requirements

## API Response Time

### Public APIs

Average response time

≤ 200 ms

95th percentile

≤ 500 ms

99th percentile

≤ 1 second

---

### Authenticated APIs

Average

≤ 250 ms

95th percentile

≤ 600 ms

---

### Heavy Operations

Examples

Analytics

Reports

Exports

Maximum execution time

≤ 30 seconds

Heavy tasks must execute asynchronously using BullMQ.

---

# Database Performance

Requirements

* Indexed foreign keys
* Indexed search columns
* Indexed reservation lookups
* Indexed restaurant lookups

No N+1 queries.

Avoid full table scans.

Optimize Prisma queries.

Target

Reservation lookup

<100 ms

---

# Concurrency

The system must support:

* Thousands of simultaneous users
* Thousands of concurrent WebSocket connections
* Hundreds of reservation requests per second

Reservation conflicts must never occur. This is satisfied technically by PostgreSQL transaction-level advisory locks scoped to `(branch, table, timeslot)`, backed by a database exclusion constraint as a safety net — see ADR-013 in DECISIONS.md for the full mechanism and failure-mode analysis.

Database transactions must guarantee consistency.

---

# Scalability

The application must be horizontally scalable.

Stateless API servers.

Shared Redis cache.

Shared queue system.

Externalized file storage.

No local persistent storage.

Future support for Kubernetes deployment must be possible without architectural redesign.

---

# Availability

Target uptime

99.9%

Maximum planned downtime

4 hours/month

Application should remain operational during rolling deployments.

---

# Reliability

Critical business operations must never result in data corruption.

Reservation approval

Reservation cancellation

Payment processing

Subscription changes

All require transactional integrity.

---

# Consistency

Reservation data must always remain strongly consistent.

Analytics and reports may be eventually consistent.

---

# Fault Tolerance

Failures in one subsystem must not bring down the entire application.

Examples

Notification provider failure

Image upload failure

Analytics worker failure

Email provider outage

The platform must continue serving reservations.

---

# Retry Strategy

Background jobs

Exponential backoff

Maximum retries

5

Dead Letter Queue required.

---

# Caching

Redis caching allowed for:

Restaurant listings

Restaurant details

Menu data

Settings

Analytics

Never cache:

Authentication secrets

Permission checks as a long-lived, independently-invalidated cache layer (e.g., a Redis permission cache that could go stale after a role change) — see the Authorization section above for how permission checks are instead kept fast without this risk (short-lived JWT claims, refreshed on change).

Payment states

Reservation transaction state

---

# Security

Authentication

JWT

Refresh Tokens

Argon2

Secure Cookies (when applicable)

HTTPS only

---

# Authorization

Role Based Access Control

Permission-based authorization. Effective permissions are resolved as role grants combined with individual overrides (see DOMAIN_MODEL.md's Employee Permission Inheritance rule) and embedded in short-lived JWT claims, refreshed on any role/override change — this is the concrete mechanism satisfying the "never cache permission checks" rule below without recomputing from the database on every single request.

Organization (tenant) isolation — see ADR-012 and TENANCY.md for the enforcement mechanism.

Restaurant isolation

Branch isolation — see DOMAIN_MODEL.md's Employee Branch Rules.

---

# Password Policy

Minimum length

12 characters

Require

Uppercase

Lowercase

Number

Special character

Passwords never stored in plaintext.

---

# Encryption

TLS 1.3

AES-256 for sensitive stored secrets where applicable.

Environment secrets must never exist in source control.

---

# Sensitive Data

Never log:

Passwords

Tokens

OTP codes

Private keys

Payment secrets

Personal identification numbers

---

# Privacy

The platform must be designed to support privacy regulations such as GDPR and similar frameworks.

Capabilities should include:

* User data export
* Account deletion workflow
* Consent tracking
* Configurable retention periods

"Account deletion" is satisfied through anonymization-in-place, not physical deletion, reconciling this requirement with the immutable-audit-log and never-physically-delete-reservations rules elsewhere in this document and in DATABASE_SCHEMA.md. See ADR-014 for the full mechanism.

---

# Auditability

Critical operations require immutable audit logs.

Examples

Login

Reservation approval

Role changes

Restaurant updates

Subscription changes

Payment events

Audit logs must include:

Timestamp

Actor

Action

Target

Correlation ID

IP Address (when appropriate)

---

# Monitoring

Every production deployment must expose:

Health endpoint

Readiness endpoint

Liveness endpoint

Metrics endpoint

---

# Logging

Use structured JSON logging.

Every request receives:

Correlation ID

Request ID

Timestamp

Execution time

Never log sensitive information.

---

# Observability

Support integration with:

Prometheus

Grafana

OpenTelemetry

Jaeger

Elastic Stack

Sentry

The platform should expose metrics for:

API latency

Queue latency

Database latency

WebSocket connections

Redis pub/sub throughput (Socket.IO Redis Adapter fan-out — see ADR-015; tracked separately from cache hit ratio since it has distinct load characteristics)

Cache hit ratio

Reservation throughput

Notification success rate

Error rate

---

# Backup Strategy

Database

Daily full backup

Hourly incremental backup

Retention

30 days

Object Storage

Daily backup

Configuration

Version controlled

---

# Disaster Recovery

Recovery Time Objective (RTO)

≤ 2 hours

Recovery Point Objective (RPO)

≤ 15 minutes

Backups must be tested regularly.

---

# High Availability

Future deployment should support:

Multiple API instances

Load balancer

Database replication

Redis replication

Worker replication

Zero-downtime deployments

---

# File Storage

Use MinIO.

Requirements

Private buckets

Public buckets

Signed URLs

Virus scanning before persistence (future enhancement)

Maximum upload size configurable.

---

# Notification Delivery

Notification system should support:

Push

Email

WebSocket

Future SMS

Failures should not affect reservation processing.

---

# API Stability

Public APIs must remain backward compatible within the same major version.

Breaking changes require:

New API version

Migration documentation

Deprecation period

---

# Code Quality

Strict TypeScript

ESLint

Prettier

Conventional Commits

Code reviews required

No duplicated business logic

Cyclomatic complexity should remain low.

---

# Testing Requirements

Minimum coverage

90%

Critical modules

95%

Reservation Engine

Authentication

Payments

Notifications

Realtime Gateway

All require integration and end-to-end tests.

---

# Deployment Requirements

Every deployment must include:

Automated migrations

Health checks

Rollback strategy

Environment validation

Container verification

Smoke tests

---

# Configuration

Configuration must be environment-based.

Development

Testing

Staging

Production

No hardcoded values.

---

# Localization

The platform must support:

Multiple languages

RTL languages

LTR languages

Unicode

Time zones

See LOCALIZATION.md for the locale-resolution mechanism, notification-template translation strategy, and time zone handling rules.

---

# Currency Support

The architecture must support:

Multiple currencies

Configurable exchange rates

Future financial integrations

Business logic must never assume a single currency. Currency is owned at the Branch level (see DOMAIN_MODEL.md's Money/Currency Ownership and LOCALIZATION.md) so that a multi-country restaurant chain can transact in each branch's local currency.

---

# Accessibility

Dashboard interfaces should be designed to support accessibility best practices (WCAG 2.1 AA) even though implementation is handled by the frontend.

---

# Maintainability

Every feature must include:

Documentation

Tests

Architecture consistency

Dependency analysis

No circular dependencies.

---

# Extensibility

The system must support future addition of:

Loyalty Programs

Gift Cards

QR Ordering

Online Payments

Delivery

Takeaway

Kitchen Display Systems

POS Integration

AI Recommendations

Multi-country deployment

without requiring architectural redesign.

---

# Capacity Planning

Initial production target:

* 10,000 restaurants
* 500,000 registered users
* 50,000 daily active users
* 100,000 reservations per day
* 25,000 concurrent WebSocket connections

The architecture should be capable of scaling beyond these figures through horizontal expansion.

---

# Service Level Objectives (SLO)

API success rate

≥ 99.9%

Reservation success rate

≥ 99.99%

Notification delivery success

≥ 99%

Authentication success

≥ 99.99%

Queue processing success

≥ 99.9%

---

# Definition of Production Ready

A release is considered production-ready only if:

* All functional requirements are implemented.
* All non-functional requirements are satisfied.
* Security review is complete.
* Performance targets are met.
* Load testing is successful.
* Documentation is up to date.
* Monitoring and alerting are configured.
* Backup and recovery procedures are verified.
* No critical or high-severity issues remain open.

---

# Engineering Principle

Every engineering decision should answer the following question:

> **Will this implementation still be reliable, secure, maintainable, and scalable when the platform grows from one restaurant to ten thousand restaurants?**

If the answer is **no**, the implementation must be redesigned before being accepted.
