PHASE 15.6 — MESSAGING
FULL IMPLEMENTATION + VERIFICATION + LIVE PRODUCTION VALIDATION

You are continuing the Tavla backend repository.

==================================================
CURRENT PROJECT STATUS
==================================================

Phase 15 Optimization:
- COMPLETE
- LIVE VERIFIED
- PRODUCTION VERIFIED

Phase 15.6 Messaging:
- Architecture Audit COMPLETE.
- Owner Decisions COMPLETE.
- Architecture Freeze COMPLETE.

The architecture is frozen.

DO NOT reopen any architectural discussion.

DO NOT redesign Messaging.

Implement exactly the frozen architecture.

==================================================
MANDATORY PREPARATION
==================================================

Before writing any production code, re-read and synchronize with:

TASKS.md

docs/DECISIONS.md

docs/CHANGE_POLICY.md

docs/DOMAIN_MODEL.md

docs/DATABASE_SCHEMA.md

docs/EVENTS.md

docs/API_GUIDELINES.md

docs/AUTHORIZATION_ARCHITECTURE.md

docs/ARCHITECTURE_LOCK.md

README.md

==================================================
STEP 0
ARCHITECTURE RECONCILIATION
==================================================

Verify that the frozen decisions D1–D15 are internally consistent.

Do NOT change them.

Use them exactly.

==================================================
STEP 1
ADR-030
==================================================

Before schema implementation:

Create ADR-030.

ADR-030 MUST:

- reference ADR-011
- reference ADR-012
- reference ADR-020

Describe ONLY the tenant-scoping correction.

Conversation MUST NOT own organizationId.

Conversation tenancy MUST resolve through:

Conversation
→ restaurantId
→ Restaurant.organizationId

Do NOT rewrite ADR-020.

ADR-030 is additive only.

Update:

docs/DECISIONS.md

and every required documentation reference.

==================================================
STEP 2
DATABASE
==================================================

Implement the frozen schema.

Conversation

ConversationParticipant

Message

Apply D1 exactly.

Conversation MUST NOT contain organizationId.

restaurantId is authoritative.

Implement every frozen index.

Implement every frozen constraint.

Implement D10:

nullable anonymizedAt.

Implement D7:

Message in FileOwnerType.

Generate ONE additive migration.

No destructive migrations.

==================================================
STEP 3
DOMAIN
==================================================

Implement:

Conversation

ConversationParticipant

Message

ConversationPolicy

Repositories

Value Objects

Domain Events

ConversationStarted

MessageSent

MessageRead

ConversationClosed

No framework leakage.

==================================================
STEP 4
APPLICATION
==================================================

Implement all frozen use cases:

StartConversation

SendMessage

ListCustomerConversations

ListRestaurantConversations

ListMessages

MarkConversationRead

CloseConversation

Use D15 exactly.

Dual Actor architecture:

Employee
+
OrganizationMember

Use use-case branching exactly like Analytics and Merge/Split.

Do NOT invent a third authorization model.

==================================================
STEP 5
AUTHORIZATION
==================================================

Employee:

permissions:

conversations:manage

branch scoped.

OrganizationMember:

Owner/Admin

organization scoped.

Exactly as frozen.

==================================================
STEP 6
INFRASTRUCTURE
==================================================

Implement Prisma repositories.

Resolve tenancy only through:

restaurantId

Never organizationId.

Reuse existing:

RateLimiterPort

Idempotency

AuditingEventPublisher

RealtimeEventPublisher

NotifyingEventPublisher

No new infrastructure.

==================================================
STEP 7
REALTIME
==================================================

Extend existing realtime.

Add:

Conversation RoomType

authorizeConversation()

Realtime mapping:

ConversationStarted

MessageSent

MessageRead

ConversationClosed

Broadcast:

conversation:{conversationId}

No regression to existing rooms.

==================================================
STEP 8
NOTIFICATIONS
==================================================

Implement D6 exactly.

Customer only.

When Staff replies:

publish existing Notification.

No Employee notification.

No OrganizationMember notification.

Reuse existing notification pipeline.

==================================================
STEP 9
FILES
==================================================

Add:

Message

to FileOwnerType.

Reuse existing upload pipeline.

No virus scanning.

No new storage.

==================================================
STEP 10
API
==================================================

Implement exactly:

Customer

GET /conversations

Staff

GET /restaurants/:restaurantId/conversations

Shared

GET /conversations/:id

GET /conversations/:id/messages

POST /conversations

POST /conversations/:id/messages

POST /conversations/:id/read

POST /conversations/:id/close

Swagger complete.

DTO validation complete.

Cursor pagination.

Default:

50

Maximum:

100

==================================================
STEP 11
ABUSE PROTECTION
==================================================

Implement D8.

Reuse RateLimiterPort.

Per participant.

Messaging policy only.

Implement D12.

Reuse existing Idempotency-Key.

==================================================
STEP 12
TESTS
==================================================

Implement exhaustive tests.

Unit.

Integration.

E2E.

Strict.

Include:

ConversationPolicy

Authorization

Dual Actor

Cross tenant denial

Cross branch denial

Cursor pagination

Rate limiting

Idempotency

Realtime

Notifications

Attachments

MessageRead

CloseConversation

Auto reopen

Archived

GDPR compatibility

Tenant resolution

No N+1 regressions

==================================================
STEP 13
VERIFICATION
==================================================

Execute:

TypeScript

ESLint

Nest build

Prisma validate

Prisma migrate status

Docker rebuild

Dev

Strict

Health checks

Integration

E2E

Realtime verification

Notification verification

Attachment verification

Live HTTP verification

Live WebSocket verification

==================================================
STEP 14
DOCUMENTATION
==================================================

Synchronize all documentation.

Update:

TASKS.md

DATABASE_SCHEMA.md

DOMAIN_MODEL.md

EVENTS.md

API_GUIDELINES.md

AUTHORIZATION_ARCHITECTURE.md

DECISIONS.md

README.md

PROJECT_ROADMAP.md

Every implementation must match documentation.

==================================================
STEP 15
ENGINEERING REPORT
==================================================

Produce a comprehensive engineering report containing:

Executive Summary

Architecture Compliance

ADR-030 Summary

Schema Changes

Migration Summary

Authorization Summary

Realtime Summary

Notification Summary

Files Summary

API Summary

Tests

Verification Results

Docker Verification

Live Verification

Performance Observations

Security Review

Documentation Changes

Files Changed

Remaining Risks

Git Diff Summary

==================================================
FINAL GATES
==================================================

You may declare ONLY IF every gate genuinely passes:

PHASE 15.6 MESSAGING COMPLETE

PHASE 15.6 LIVE VERIFIED

PHASE 15.6 PRODUCTION VERIFIED

Otherwise clearly identify every failing gate.

Do NOT begin any later roadmap phase.

HARD STOP.