# API GUIDELINES

## API Version

All endpoints must be versioned.

Example:

/api/v1

---

# Naming Convention

Use plural nouns.

Correct:

/restaurants

/reservations

/tables

/users

Incorrect:

/getRestaurants

/createReservation

---

# HTTP Methods

GET

Retrieve resources.

POST

Create resources.

PUT

Replace resources.

PATCH

Partial updates.

DELETE

Soft delete unless otherwise specified.

---

# Response Format

Successful Response

```json
{
  "success": true,
  "message": "Reservation created successfully.",
  "data": {},
  "meta": {}
}
```

Error Response

```json
{
  "success": false,
  "message": "Validation failed.",
  "code": "VALIDATION_ERROR",
  "errors": [],
  "timestamp": "",
  "path": ""
}
```

The `code` field carries the application error code from the Error Codes section below. It is always present on error responses, including generic HTTP failures (401/403/404) that are not yet tied to a domain-specific code.

---

# Pagination

Support:

page

limit

sort

order

Cursor pagination for large datasets.

---

# Filtering

Example

GET /restaurants?city=Damascus&rating=5

---

# Sorting

Example

sort=createdAt

order=desc

---

# Validation

Every request must be validated.

Never trust client input.

---

# Authentication

Authorization: Bearer <token>

Refresh tokens must never be sent in URLs.

---

# Status Codes

200 OK

201 Created

204 No Content

400 Bad Request

401 Unauthorized

403 Forbidden

404 Not Found

409 Conflict

422 Unprocessable Entity

429 Too Many Requests

500 Internal Server Error

---

# DTO Rules

Never expose database entities directly.

Always return Response DTOs.

---

# File Upload

Multipart only.

Validate:

* MIME type
* File size
* Extension

---

# API Documentation

Every endpoint must include:

Summary

Description

Parameters

Responses

Examples

Authentication requirements

Swagger documentation is mandatory.

---

# API Design Principles

Keep endpoints predictable.

Avoid deeply nested routes, but judge nesting by **aggregate boundaries**, not by raw URL segment count. A collection may be nested beneath its aggregate root when the child's identity is otherwise ambiguous without that root (e.g., a table is meaningless without its branch); that aggregate root may itself already be exposed through its own parent resource (e.g., a Branch, whose collection lives at `/restaurants/:restaurantId/branches` per Phase 5.1's approved, production-verified routing) - in that case the child's collection route naturally reflects the same path, and the resulting URL depth is not itself an architectural smell. What matters is that the nesting still traces a single, unbroken aggregate-ownership chain (Restaurant → Branch → Table), not an arbitrary combination of unrelated resources.

Whatever the collection route's depth, once a resource's own id is known it must also be reachable through a flat, directly-addressable route for read/update/delete (`/tables/:id`), independent of its parents' ids. Never construct a route that skips a level of the ownership chain or combines resources that are not in a direct aggregate relationship.

Example (Branch → Table, matching the implemented, production-verified architecture):

* Collection, nested under the full aggregate-ownership chain: `POST /restaurants/:restaurantId/branches/:branchId/tables`, `GET /restaurants/:restaurantId/branches/:branchId/tables`
* Individual resource, flat once the table's own id is known: `GET /tables/:tableId`, `PATCH /tables/:tableId`, `DELETE /tables/:tableId`

Domain actions (business commands that don't fit generic CRUD) use `POST` on an action-suffixed sub-route, not `PATCH`, even when they mutate only one field - `PATCH` is reserved for partial updates of a resource's own attributes. This is already the documented pattern for `POST /reservations/:id/reschedule` (see Idempotency, above); `POST /reservations/:id/approve` and `POST /reservations/:id/reject` (Phase 7.2 — Approval Workflow, architecture frozen; there is no `PATCH /reservations/:id`) follow the identical convention - Approve and Reject are each their own dedicated Domain Action, not folded into a single generic status endpoint, since they carry materially different side effects (Approve calls `Table.reserve()`; Reject performs no Table operation at all - see TASKS.md's "Phase 7.2 — Approval Workflow: Architecture Correction" note); the Table Module's `POST /tables/:tableId/move` (Phase 6.2 architecture decision) follows the same convention - it reassigns a Table's `floorPlanId` to a different FloorPlan within the same Branch as a dedicated Domain Action, kept fully separate from `PATCH /tables/:tableId` (Update Table), which is responsible only for the Table's own attributes and never touches `floorPlanId`. `POST /tables/:tableId/status` (Status Management architecture decision) follows the identical convention for status transitions: one dedicated Domain Action covering every transition (`{ "status": "<TableStatus>" }`), not separate `disable`/`enable` sub-routes - disabling and enabling are state transitions within the Table lifecycle, not independent business capabilities. Restricted to the transitions `Available ↔ Occupied`, `Available ↔ Cleaning`, and `Available ↔ Disabled`; any other transition is rejected as a business validation error. Kept fully separate from `PATCH /tables/:tableId`, which never touches `status`.

Prefer filtering over custom endpoints.

Ensure backward compatibility between API versions.

Deprecate endpoints before removal, signaled via a `Deprecation` header (RFC 8594) and a `Sunset` header giving the removal date; the deprecation period must be at least one minor version.

---

# Webhook Endpoints

Inbound webhooks (payment provider callbacks, OneSignal delivery receipts) are a distinct category from client-facing endpoints:

* Every webhook endpoint verifies the provider's signature (HMAC or provider-specific scheme) before processing; an invalid signature returns `401 Unauthorized` without processing the payload.
* Webhook handlers are idempotent — a provider may deliver the same event more than once, and processing it twice must not duplicate side effects (e.g., must not double-credit a payment).
* Webhook payloads are persisted (e.g., in `Payment Transactions.rawProviderPayload`, per DATABASE_SCHEMA.md) before triggering any business logic, so a processing failure can be replayed from the stored payload rather than lost.

---

# Error Codes

Use consistent application error codes.

Example:

AUTH_INVALID_TOKEN

AUTH_EXPIRED_TOKEN

AUTH_INVALID_CREDENTIALS

AUTH_INVALID_REFRESH_TOKEN

AUTH_EMAIL_NOT_VERIFIED

AUTH_ACCOUNT_LOCKED

AUTH_ACCOUNT_SUSPENDED

AUTH_PASSWORD_REUSED

AUTH_TOO_MANY_SESSIONS

AUTH_SESSION_NOT_FOUND

CONFLICT

RATE_LIMIT_EXCEEDED

RESERVATION_CONFLICT

RESERVATION_RESCHEDULE_WINDOW_EXPIRED

PARTY_SIZE_EXCEEDS_CAPACITY

TABLE_UNAVAILABLE

TABLE_MERGE_CONFLICT

BRANCH_HAS_FUTURE_RESERVATIONS

RESTAURANT_NOT_FOUND

RESTAURANT_SUSPENDED

ORGANIZATION_LIMIT_EXCEEDED

GALLERY_LIMIT_EXCEEDED

EMPLOYEE_BRANCH_NOT_ASSIGNED

TENANT_CONTEXT_MISSING

IDEMPOTENCY_KEY_CONFLICT

VALIDATION_ERROR

UNAUTHORIZED

FORBIDDEN

NOT_FOUND

UNKNOWN_ERROR

FILE_TOO_LARGE

UNSUPPORTED_FILE_TYPE

INVALID_FILE

STORAGE_UNAVAILABLE

---

# Reservation Availability Search Response Contract

`GET /reservations/availability` (Phase 7.1 architecture decision, 2026-07-20) is informational only and never hides a table from the response.

* The response includes every table matching the search criteria (branch, date/time, party size against capacity, `TableStatus = Available`).
* Every table in the response carries an explicit availability indicator.
* A table already holding a `Pending` or `Approved` reservation for the requested window is still returned, marked Reserved/Unavailable rather than omitted.
* Clients must not infer availability merely from a table's presence in the response — presence means "matches the search criteria," not "bookable." Clients must read the availability indicator on each table.
* The UI is responsible for how the Reserved/Unavailable state is displayed.
* This endpoint performs no conflict check and reserves nothing. Reservation creation (`POST /reservations`) remains the sole authoritative conflict check, enforced at two independent layers per ADR-013 (an advisory lock and a database exclusion constraint) - a table shown as available here may no longer be available by the time a client submits a create request, and vice versa.

---

# Idempotency

Sensitive operations such as payment and reservation creation should support idempotency keys where appropriate.

Concretely: the client supplies an `Idempotency-Key` header (a client-generated UUID) on the request. The server stores the key alongside the resulting response for 24 hours; a repeated request with the same key within that window returns the original stored response (same status code and body) without re-executing the operation, rather than creating a duplicate resource. A repeated request with the same key but a materially different body returns `422 Unprocessable Entity` with error code `IDEMPOTENCY_KEY_CONFLICT`. This applies to `POST /reservations`, `POST /reservations/:id/reschedule`, and all payment-initiating endpoints.

---

# Rate Limiting

Authentication endpoints:

Strict limits.

Public search endpoints:

Moderate limits.

Internal authenticated APIs:

Role-based limits where necessary.
