export interface StoredIdempotentResponse {
  statusCode: number;
  body: unknown;
}

/**
 * DECISIONS.md D12 - no generic `Idempotency-Key` handling existed anywhere
 * in this codebase before Phase 15.6. Scoped to `POST /conversations` and
 * `POST /conversations/:id/messages` only. Best-effort: a plain read-then-
 * write, not a distributed lock - two genuinely simultaneous requests
 * carrying the same key may both execute the underlying command once each
 * (the second write simply overwrites the first's cached response). This
 * covers the common case D12 targets (a client retrying after a timeout/
 * disconnect), not true concurrent-duplicate-submission dedup.
 */
export interface IdempotencyStorePort {
  get(key: string): Promise<StoredIdempotentResponse | null>;
  save(key: string, response: StoredIdempotentResponse, ttlSeconds: number): Promise<void>;
}
