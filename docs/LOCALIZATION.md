# LOCALIZATION.md

# Enterprise Restaurant Reservation Platform

Version: 1.0

---

# Purpose

Multi-language, multi-currency, RTL/LTR, and multi-country support are repeated as headline goals across README.md, NON_FUNCTIONAL_REQUIREMENTS.md, and DOMAIN_MODEL.md, but no prior document specified *where* translated content lives or *how* currency/locale defaults are resolved. This document defines the mechanism; NON_FUNCTIONAL_REQUIREMENTS.md's Localization/Currency Support sections remain the source of the requirement itself.

---

# Two Distinct Localization Problems

It is important to separate two problems that are easy to conflate:

1. **UI/System localization** — translating interface labels, system-generated notification copy, and error messages. This is largely a frontend/client concern, with the backend contributing translated `NotificationTemplate` content (see below) and locale-aware formatting (dates, numbers, currency symbols).
2. **Business content translation** — translating restaurant-owner-authored content (restaurant descriptions, menu item names/descriptions, offer copy) into multiple languages. This is explicitly listed as an **open decision** in DECISIONS.md's Future Decisions ("Multi-language strategy... translatable business content") and is *not* resolved by this document — it requires its own ADR once the product scope for content translation (machine-translated vs. owner-provided per-language vs. untranslated) is decided.

This document defines the mechanism for (1) only, since it directly affects Phase 1 infrastructure and Phase 9 (Notification System) design.

---

# Locale Resolution

Every request resolves an effective locale from, in order of precedence:

1. An explicit `Accept-Language` header or client-specified locale parameter, if the endpoint supports one.
2. The authenticated `User.language` field, if the user is authenticated.
3. The `Country.defaultLocale` of the Branch being viewed/booked, for anonymous/public browsing endpoints (e.g., a public restaurant listing page defaults to the branch's local language for an anonymous visitor).
4. A platform-wide default locale (configured via `SystemConfiguration`), as the final fallback.

The resolved locale is attached to the Tenant Context / request context (see TENANCY.md) for the duration of the request, so any service needing it (notification dispatch, formatting) reads it from one place rather than re-deriving it.

---

# Notification Content

Per DOMAIN_MODEL.md's Notifications business rule and the `Notification Templates` table in DATABASE_SCHEMA.md: every system-generated notification resolves its content through a `NotificationTemplate` keyed by `(eventType, language, channel)`. If no template exists for the recipient's resolved language, the template marked `isDefault` for that `(eventType, channel)` pair is used instead — a notification is never sent with missing or blank content, and a missing translation is never a hard failure, only a silent fallback (logged at `info` level for content-ops visibility, never treated as an error).

Adding a new language for system notifications is a **content/data change** (inserting new `NotificationTemplate` rows), never a code or deployment change — this is the entire reason `NotificationTemplate` exists as a database entity rather than being embedded in application code (see the table's Purpose note in DATABASE_SCHEMA.md).

**Phase 9 freeze note (2026-07-25, `TASKS.md`'s Phase 9 decision item 15 — implemented 2026-07-25):** this mechanism is confirmed as the frozen v1 design, unchanged from this section's existing description. Recipient language resolution is `User.language` only in v1 (Phase 9 v1 has no Employee/OrganizationMember/`ReservationGuest` recipient — see `DOMAIN_MODEL.md`'s Notifications rules). Templates are platform-global only (no restaurant-specific override) and unversioned. `Push` and `InApp` may carry separate resolved content for the same `(eventType, language)` pair, since `channel` is already part of the template's unique key.

---

# Currency Formatting and Rounding

Per DOMAIN_MODEL.md's Money/Currency Ownership rule, currency is owned at the Branch level. The `Currency` reference table (DATABASE_SCHEMA.md) stores `decimalPlaces` per currency code (e.g., 2 for USD/EUR, 0 for JPY) so that:

* `Money` value object arithmetic always rounds according to the currency's actual precision, never a hardcoded assumption of 2 decimal places.
* Any UI/report displaying a `Money` amount formats it using the currency's symbol and decimal convention, resolved from the `Currency` table, never a client-side hardcoded format map.

**Cross-branch/cross-currency aggregation rule** (restated from DOMAIN_MODEL.md for emphasis, since it is a common source of subtle bugs): a report or dashboard view spanning multiple branches with different currencies must present amounts grouped per-currency, or via an explicit, clearly-labeled currency-converted total using a documented exchange-rate source and timestamp. Silently summing `Money.amount` values across different currencies is a defect, not an edge case — this must be caught in code review for any Analytics (Phase 14) feature touching multi-branch data.

---

# RTL / LTR Support

The backend's obligation for RTL language support (e.g., Arabic) is limited to:

* Never assuming LTR text direction when generating any user-facing string ordering (e.g., concatenating a name and a title must not assume a fixed left-to-right reading order baked into a template).
* Passing through the resolved locale so the frontend can apply the correct `dir` attribute — the backend does not render UI and does not need its own RTL logic beyond correct locale propagation.

Full RTL rendering is a frontend/mobile concern, tracked outside this backend-focused document; NON_FUNCTIONAL_REQUIREMENTS.md's Accessibility section already defers UI accessibility implementation to the frontend.

---

# Time Zones

Every `Branch.timezone` is authoritative for that branch's opening hours, reservation slot generation, and displayed reservation times to restaurant staff. All timestamps are stored in UTC in the database (per DATABASE_SCHEMA.md's Timestamp Policy) and converted to the relevant branch's timezone only at the presentation boundary (API response formatting or notification content rendering) — business logic (availability calculation, expiration jobs) always operates in UTC internally to avoid daylight-saving-time and cross-timezone comparison bugs.

---

# What Remains an Open Decision

* Business content translation strategy (restaurant descriptions, menu items) — see DECISIONS.md Future Decisions.
* Currency conversion/exchange-rate provider for any future cross-currency financial reporting — see DECISIONS.md Future Decisions ("Multi-currency strategy").
* Right-to-left layout testing tooling for the (future) Next.js dashboard and Flutter app — outside backend scope.
