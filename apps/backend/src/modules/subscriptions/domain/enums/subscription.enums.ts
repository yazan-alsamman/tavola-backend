/**
 * Phase 12 (Subscriptions, architecture frozen 2026-07-28, ADR-027).
 * Entitlement/access-contract lifecycle only - no billing-derived states
 * (`PastDue`, `Trialing` explicitly excluded, ADR-027 §6).
 */
export enum SubscriptionStatus {
  Active = 'Active',
  Suspended = 'Suspended',
  Cancelled = 'Cancelled',
  Expired = 'Expired',
}
