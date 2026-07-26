/**
 * Phase 8 §17 — the one canonical realtime payload shape, emitted on the one
 * canonical Socket.IO channel (`domain.event`, see `REALTIME_CHANNEL` in
 * `realtime-event-mapping.ts`). No per-domain-event Socket.IO channel name is
 * ever created - `eventType` (inside the envelope) is how a client
 * discriminates, not the channel it arrived on.
 */
export interface RealtimeEnvelope {
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly correlationId: string | null;
  readonly data: Record<string, unknown>;
}
