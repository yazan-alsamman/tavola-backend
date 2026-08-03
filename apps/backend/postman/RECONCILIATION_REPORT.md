# Postman Collection Reconciliation Report

Generated: 2026-08-03T16:50:00.000Z

## Source of truth

NestJS controllers under `apps/backend/src` (machine inventory: `_endpoint_inventory.json`).

Documentation, Swagger, README, and prior collections were **not** treated as authoritative.

---

## Discovery summary

| Metric | Count |
|--------|------:|
| Controllers discovered | 30 |
| Endpoints discovered | 173 |
| Previous collection requests | 138 |
| New collection requests | 173 |
| Endpoints added | 36 |
| Endpoints removed | 1 |
| Endpoints corrected | 5 |
| Duplicate requests removed | 1 |
| Missing from new collection | **0** |
| Extra in new collection | **0** |
| Duplicate keys in new collection | **0** |

Math check: `138 − 1 (duplicate Create Reservation) + 36 (Menu Phase 18 × 35 + Metrics × 1) = 173`.

---

## Endpoints added (backend present, old collection missing)

### Menu — Phase 18 (35)

All routes under `/restaurants/:restaurantId/menus…` including:

- Menus: create, list (public), get default (public), get (public), update, activate, deactivate, set-default, delete
- Categories: create, reorder, get (public), update, delete, upload/remove image
- Items: create, reorder, get (public), update, delete, feature, unfeature, availability, upload/remove image
- Option groups & options: full CRUD
- Add-ons: create, update, delete

### Utilities (1)

- `GET /metrics` (Prometheus text exposition)

---

## Endpoints removed (old collection only)

- Duplicate `POST /reservations` named **Create Reservation (Phone/Walk-In)** — same route as Create Reservation; channel is a body field, not a separate URL.

---

## Endpoints corrected

1. `GET /health` — was `{{apiRoot}}/health` (`/api/health`); Nest `defaultVersion: '1'` serves `/api/v1/health` (confirmed by e2e). Now `{{baseUrl}}/health`.
2. `GET /health/liveness` — same correction.
3. `GET /health/readiness` — same correction.
4. Removed obsolete `apiRoot` environment/collection variable — all routes use `{{baseUrl}}` (`…/api/v1`).
5. Request documentation standardized (Purpose / Authorization / Required Role / Headers / Params / Body / Success / Errors / Notes) on every request.

---

## Missing documentation fixed

- Role separation on every request (`Required Role`).
- Bearer auth at collection level; public → `noauth`; Platform Admin → `{{platformAdminAccessToken}}`; customer-primary → `{{customerAccessToken}}`.
- Menu (Phase 18), Messaging (Phase 15.6), Analytics, Offers, Subscriptions included.
- Multipart examples for gallery, avatar, review images, menu images, conversation attachments.
- Test scripts capture JWTs and created IDs (login, create restaurant/branch/menu/category/item/offer/reservation/conversation/etc.).

---

## Final folder hierarchy

```
00 - Authentication                         (19)
01 - Public Mobile API                       (0)  → see 07 Discovery (+ public reads under Menu/Reviews)
02 - Customer API                            (9)  /users/me/* + GET /users/me/reviews
03 - Restaurant Dashboard API                (0)  → capability folders 11–19, 15–18
04 - Employee API                            (0)  → Reservations/Waitlist/Tables/Menu/Analytics/Messaging (per-request role)
05 - Organization Owner/Admin API            (0)  → 14 Analytics + 21 Organizations
06 - Platform Administration API             (1)  provision restaurant owners
07 - Discovery                              (10)  public discovery + taxonomy
08 - Reservations                           (11)
09 - Waitlist                                (3)
10 - Reviews                                 (7)
11 - Offers                                  (5)
12 - Menu                                   (35)
13 - Messaging                               (8)
14 - Analytics                               (7)
15 - Restaurants                            (16)
16 - Branches                                (7)
17 - Floor Plans                             (4)
18 - Tables                                  (9)
19 - Employees                               (5)
20 - Roles & Permissions                     (0)  no dedicated controller; assign via Employees
21 - Organizations                           (2)  subscription + usage
22 - Subscriptions                           (6)  platform-admin plans/lifecycle
23 - Notifications                           (5)
24 - File Uploads                            (0)  multipart kept with parent resources (exactly-once rule)
25 - Health                                  (3)
26 - Utilities                               (1)  metrics
```

Empty numbered folders are intentional: each backend route appears **exactly once**, grouped by business capability. Role folders document where to look; per-request **Required Role** carries the authoritative actor label.

---

## Role categorization (by Required Role label)

| Role label | Requests |
|------------|--------:|
| Public | 35 |
| Restaurant Owner/Admin | 59 |
| Authenticated (use-case dual-actor; see Notes) | 30 |
| Restaurant Owner/Admin \| Employee | 14 |
| Customer \| Employee | 13 |
| Customer | 9 |
| Platform Admin | 7 |
| Employee | 6 |
| **Total** | **173** |

---

## Verification (first pass + second pass)

### Pass 1 — inventory vs collection

```
Backend endpoints:       173
Collection requests:     173
Missing from collection: 0
Extra in collection:     0
Duplicates:              0
```

### Pass 2 — independent re-scan of all `*.controller.ts` vs collection

```
Controllers scanned:     30
Backend endpoints:       173
Collection requests:     173
Missing:                 0
Extra:                   0
Collection duplicates:   0
Undocumented requests:   0
```

**PASS: There are zero backend endpoints missing from the Postman Collection.**

Every endpoint exists exactly once.

---

## Outputs

1. `apps/backend/postman/TAVLA-API.postman_collection.json` — rebuilt collection
2. `apps/backend/postman/TAVLA-API.postman_environment.json` — rebuilt environment
3. `apps/backend/postman/RECONCILIATION_REPORT.md` — this report
4. `apps/backend/postman/_endpoint_inventory.json` — controller inventory
5. `apps/backend/postman/_second_pass_verification.json` — second-pass machine result
