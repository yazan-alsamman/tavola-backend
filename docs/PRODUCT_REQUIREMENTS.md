# PRODUCT_REQUIREMENTS.md

# Enterprise Restaurant Reservation Platform (TAVLA)

Version: **1.0**  
Document Status: **Approved** (synthesized at Architecture Compliance Audit, 2026-07-07)  
Authority: **Business source of truth** for functional scope

---

# Purpose

This document is the **Product Requirements Document (PRD)** for TAVLA. It consolidates business requirements from the platform vision, `TASKS.md` phase plan, `DOMAIN_MODEL.md`, `DATABASE_SCHEMA.md`, and stakeholder audit scope.

Implementation phases in `TASKS.md` deliver subsets of this document. Absence from a completed phase does **not** mean absence from product scope.

---

# Product Vision

Multi-tenant SaaS enabling restaurants to manage reservations, operations, customer engagement, and billing — with customer-facing discovery, booking, reviews, and notifications across web and mobile clients.

**Scale targets** (see `NON_FUNCTIONAL_REQUIREMENTS.md`): 10,000+ restaurants, 500,000+ users, 100,000+ reservations/day without architectural redesign.

---

# Actors

| Actor | Description |
|---|---|
| **Guest / Customer** | Registered user booking, reviewing, favoriting restaurants |
| **Walk-in / Phone guest** | Unregistered person represented by `ReservationGuest` |
| **Restaurant Employee** | Staff with RBAC permissions scoped to organization/branches |
| **Organization Owner / Admin** | Organization-level administration and billing |
| **Platform Administrator** | Cross-tenant operations via `PlatformAdmin` + `$systemContext` |

---

# Functional Requirements

## FR-01 — Authentication

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-01.1 | ~~Email/password registration with email verification gate~~ **Superseded by ADR-022** (2026-07-22) — split into FR-01.1a/FR-01.1b below. | `AUTHENTICATION_ARCHITECTURE.md` §15, ADR-016 (partially superseded), ADR-022 |
| FR-01.1a | Customer registration is phone-first: username + phone, WhatsApp OTP via LightOTP (ADR-024, formerly Fonnte), password set only after verification succeeds. No email is collected or required. Mobile Country Code Picker defaults to Syria (+963) but supports any other supported country; backend normalizes the selected code + national number into canonical E.164 (a UX default, never a nationality restriction). | `AUTHENTICATION_ARCHITECTURE.md` §15.1/§15.10, ADR-022 |
| FR-01.1b | Restaurant Owner accounts are provisioned administratively by a Platform Admin (email + password) via `POST /platform-admin/restaurant-owners`; no public self-registration; no email-verification step; password delivery to the Owner is an out-of-band operational responsibility, outside backend scope. | `AUTHENTICATION_ARCHITECTURE.md` §15.2, ADR-022 |
| FR-01.1c | Customer password recovery uses the same phone/WhatsApp OTP mechanism as registration (`START → VERIFY → COMPLETE`), never the Owner's email-based reset flow. Owner/staff password recovery remains the existing email-based flow, unchanged. | `AUTHENTICATION_ARCHITECTURE.md` §15.11, ADR-022 |
| FR-01.2 | Login, refresh token rotation, logout, logout-all | ADR-016, `DeviceSession`, `TokenFamily` |
| FR-01.3 | Password reset, password history, Argon2id hashing | ADR-008, `PasswordHistory` |
| FR-01.4 | Device session management | `DeviceSession` |
| FR-01.5 | Brute-force protection via `LoginAttempt` | `AUTHENTICATION_ARCHITECTURE.md` §12 |
| FR-01.6 | Replay protection via token families + session version | ADR-016, ADR-017 |

## FR-02 — Authorization

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-02.1 | RBAC: roles, permissions, employee overrides | ADR-017, `AUTHORIZATION_ARCHITECTURE.md` |
| FR-02.2 | Organization admin roles (Owner, Admin, Billing) | `OrganizationMember.role` |
| FR-02.3 | Branch-scoped employee access | `EmployeeBranchAssignment` |
| FR-02.4 | Policy Engine + domain policies per aggregate | `DOMAIN_MODEL.md` § Authorization |
| FR-02.5 | Future ABAC via `PermissionAssignment` + Policy Engine | ADR-017, `PermissionAssignment` table |
| FR-02.6 | Subscription and feature-flag gating | `SubscriptionPolicy`, `FeatureFlags` |

## FR-03 — Organizations & Tenancy

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-03.1 | Organization as tenant boundary | ADR-011 |
| FR-03.2 | Organization membership and ownership invariants | `Organization`, `OrganizationMember` |
| FR-03.3 | Automatic tenant isolation on all tenant-scoped data | ADR-012, `TENANCY.md` |
| FR-03.4 | Platform administration across tenants | `PlatformAdmin`, `$systemContext` |

## FR-04 — Restaurants & Branches

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-04.1 | Restaurant CRUD, settings, working hours, gallery, social links | Phase 4, `RestaurantSettings`, `WorkingHours` |
| FR-04.2 | Branch CRUD with address, geo coordinates, timezone, currency | Phase 5, `Branches` |
| FR-04.3 | Restaurant suspension and status lifecycle | `Restaurant.status` |
| FR-04.4 | Multi-branch per restaurant under one organization | ADR-011 |

## FR-05 — Tables & Floor Plans

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-05.1 | Interactive floor map with positioned tables | `FloorPlans`, `RestaurantTables` |
| FR-05.2 | Table merge/split, VIP/smoking/indoor attributes | `DOMAIN_MODEL.md` Table rules |
| FR-05.3 | Table status management (available, occupied, reserved, …) | `RestaurantTables.status` |
| FR-05.4 | One active floor plan per branch | `FloorPlan.isActive` |

## FR-06 — Reservations

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-06.1 | Availability search and slot generation | `ReservationAvailabilityService`, ADR-013 |
| FR-06.2 | Create, approve, reject, cancel, complete, no-show | Phase 7, `Reservations` |
| FR-06.3 | Reschedule in-place with history audit | `ReservationHistory` |
| FR-06.4 | Pending reservation timeout and expiration | `RestaurantSettings` |
| FR-06.5 | Concurrency-safe booking (advisory lock + exclusion constraint) | ADR-013 |
| FR-06.6 | Phone reservations via `ReservationGuest` | `ReservationGuests` |
| FR-06.7 | Walk-in reservations via `ReservationGuest` + `source=WalkIn` | `DOMAIN_MODEL.md` |
| FR-06.8 | Reservation waiting list when no table available | ADR-019, `ReservationWaitlistEntry` |
| FR-06.9 | Reservation reminders (scheduled notifications) | Phase 9, BullMQ, `NotificationTemplate` |
| FR-06.10 | Late arrival handling and guest notification | ADR-019, `Reservation.lateArrivalNotifiedAt` |
| FR-06.11 | Table ready notification to guest | ADR-019, `Reservation.tableReadyNotifiedAt` |
| FR-06.12 | Idempotent reservation creation | `API_GUIDELINES.md` Idempotency |

## FR-07 — Discovery & Search

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-07.1 | Restaurant search (name, cuisine, location, price) | ADR-018, `RestaurantSearchService` |
| FR-07.2 | Nearby restaurants (geo query on branch coordinates) | ADR-018, `Branches.latitude/longitude` |
| FR-07.3 | Cuisine category taxonomy (multi-select per restaurant) | `CuisineCategory`, `RestaurantCuisineCategory` |
| FR-07.4 | Occasion category taxonomy (date night, business, …) | `OccasionCategory`, `RestaurantOccasionCategory` |
| FR-07.5 | Price category (`priceLevel` 1–4) | `Restaurants.priceLevel` |
| FR-07.6 | Restaurant comparison (side-by-side API for selected restaurants) | ADR-018 § Comparison API |
| FR-07.7 | Favorites | Phase 3, `Favorites` |

## FR-08 — Menus & Offers

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-08.1 | Menus, categories, items | Phase 4+, `Menus`, `MenuCategories`, `MenuItems` |
| FR-08.2 | Promotions, coupons, time-bound offers | Phase 11, `Offers` |
| FR-08.3 | Offer publication and expiration | `OfferPolicy` |

## FR-09 — Reviews & Ratings

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-09.1 | Post-completion reviews with rating and comment | Phase 10, `Reviews` |
| FR-09.2 | Review images | `ReviewImages` |
| FR-09.3 | Restaurant owner replies | `RestaurantReplies` |
| FR-09.4 | One review per completed reservation per user | `DOMAIN_MODEL.md` invariants |

## FR-10 — Notifications

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-10.1 | Multi-channel notifications (push, email, in-app) | Phase 9, `NotificationProvider` port |
| FR-10.2 | Template-driven content with localization | `NotificationTemplates`, `LOCALIZATION.md` |
| FR-10.3 | Async delivery via BullMQ | ADR-005 |
| FR-10.4 | Provider abstraction (OneSignal first) | `ARCHITECTURE.md` Anti-Corruption Layer |

## FR-11 — Real-Time

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-11.1 | Live reservation and table updates | Phase 8, ADR-015 |
| FR-11.2 | Dashboard synchronization | `EVENTS.md` WebSocket events |
| FR-11.3 | Authorized room-based broadcasts only | `TENANCY.md`, `EVENTS.md` |

## FR-12 — Subscriptions & Billing

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-12.1 | Subscription plans with feature limits | Phase 12, `SubscriptionPlans`, `Subscriptions` |
| FR-12.2 | Usage tracking | `SubscriptionUsage` |
| FR-12.3 | Payments with provider abstraction | Phase 13, `PaymentGateway` port |
| FR-12.4 | Payment transaction audit trail | `Payments`, `PaymentTransactions` |
| FR-12.5 | Invoices (PDF/document generation) | ADR-021, `Invoices` |
| FR-12.6 | Multi-currency per branch | `Branches.currency`, `LOCALIZATION.md` |

## FR-13 — Analytics & Dashboard

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-13.1 | Restaurant operational dashboard | Phase 14, WebSocket + REST |
| FR-13.2 | Reservation reports, occupancy, peak hours | `AnalyticsCalculator`, Phase 14 |
| FR-13.3 | Activity feed (denormalized read model) | `ActivityFeed`, CQRS pattern in `ARCHITECTURE.md` |
| FR-13.4 | Cross-branch currency aggregation rules | `LOCALIZATION.md` |

## FR-14 — Employee & Role Management

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-14.1 | Employee invite, role assignment, branch assignment | Phase 3–6, `Employees` |
| FR-14.2 | Permission management via roles | `Roles`, `Permissions`, `RolePermissions` |
| FR-14.3 | Employee deactivation | `Employees.status` |

## FR-15 — Files & Media

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-15.1 | Secure file upload metadata in PostgreSQL, blobs in MinIO | ADR-006, `Files` |
| FR-15.2 | Signed URL access for private assets | `FileStorageService` |
| FR-15.3 | Image associations (restaurant, menu, review) | FK references via `Files` |

## FR-16 — Customer Messaging (Chat)

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-16.1 | In-app messaging between customer and restaurant staff | ADR-020, `Conversations`, `Messages` |
| FR-16.2 | Conversation scoped to reservation when applicable | `Conversations.reservationId` |
| FR-16.3 | Real-time message delivery via WebSocket | `EVENTS.md` Chat events |
| FR-16.4 | Staff-only visibility within organization | Tenant scoping + `ConversationPolicy` |

## FR-17 — Audit & Compliance

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-17.1 | Immutable audit logs for sensitive actions | `AuditLogs` |
| FR-17.2 | GDPR account anonymization in-place | ADR-014 |
| FR-17.3 | User consent tracking | `UserConsents` |
| FR-17.4 | PII never logged | `CODING_STANDARDS.md` |

## FR-18 — Localization & Configuration

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-18.1 | Multi-language UI and notification locale | `LOCALIZATION.md`, `UserPreferences` |
| FR-18.2 | Timezone-aware reservation times per branch | `Branches.timezone` |
| FR-18.3 | System configuration key-value store | `SystemConfiguration` |
| FR-18.4 | Feature flags | `FeatureFlags` |

## FR-19 — Platform Administration

| ID | Requirement | Architecture reference |
|---|---|---|
| FR-19.1 | Platform admin user management | `PlatformAdmins` |
| FR-19.2 | Cross-tenant reporting and support tooling | `$systemContext` |
| FR-19.3 | Security alert aggregation | `SecurityAlertRaised` event |

---

# Future Requirements (No Schema Redesign Required)

Documented in `NON_FUNCTIONAL_REQUIREMENTS.md` § Extensibility. Architecture must accommodate via ports, events, and new bounded-context modules:

| Area | Approach |
|---|---|
| Loyalty programs | New `loyalty` module; events from `ReservationCompleted` |
| Gift cards | New `billing` submodule; `PaymentGateway` extension |
| QR ordering | New module; links to `Menus` + table context |
| Delivery / takeaway | New fulfillment module; branch capacity hooks |
| AI recommendations | `RecommendationService` (DOMAIN_MODEL.md Future Evolution) |
| GraphQL / Partner APIs | API gateway layer; REST remains canonical (ADR-018) |
| White-label deployments | Environment + `SystemConfiguration` branding keys; separate deployments |
| Offline mode (mobile) | Client-side cache; sync via existing REST + WebSocket |
| Microservices split | Modular monolith boundaries per `ARCHITECTURE.md` |

---

# Non-Functional Requirements

All NFRs in `NON_FUNCTIONAL_REQUIREMENTS.md` apply globally, including performance SLOs, security, scalability, observability, and extensibility.

---

# Traceability

| Document | Relationship |
|---|---|
| `TASKS.md` | Delivery phases for FR groups |
| `DOMAIN_MODEL.md` | Aggregates, invariants, domain services |
| `DATABASE_SCHEMA.md` | Persistent data model |
| `API_GUIDELINES.md` | REST contract conventions |
| `EVENTS.md` | Domain and integration events |
| `DECISIONS.md` | ADRs for architectural choices |

---

# Change Control

Functional scope changes require:

1. Update this document.
2. Update `DOMAIN_MODEL.md` and `DATABASE_SCHEMA.md` if data model affected.
3. New ADR if architectural impact (per `CHANGE_POLICY.md`).
4. Update `TASKS.md` phase checklist.
