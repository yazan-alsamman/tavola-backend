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

Avoid deeply nested routes. Prefer at most one level of nesting for ownership that is otherwise ambiguous (e.g., `/branches/:branchId/tables` is acceptable because a table's identity is meaningless without its branch), but always provide a flat, directly-addressable resource route as well (`/tables/:id`) for read/update/delete once the resource's own ID is known. Never nest more than one level (e.g., never `/restaurants/:id/branches/:id/tables/:id`).

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
