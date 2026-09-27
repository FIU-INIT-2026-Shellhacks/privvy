/**
 * CounterStore: the narrow persistence contract for per-IP rate limiting (Task 7).
 *
 * The limiter depends only on this interface, never on a concrete DB client, so its
 * logic is unit-testable with an in-memory fake and the Postgres-backed impl lives in
 * one place. Mirrors the PolicyStore / LlmProvider seams.
 *
 * PRIVACY: the `key` passed here is ALWAYS a hash of the caller IP, never a raw IP (see
 * limiter.ts). The Postgres impl expires rows past the window (TTL = RATE_LIMIT_WINDOW),
 * so nothing about the caller is retained beyond the window.
 */

export interface CounterState {
  /** Request count within the active window (after this increment). */
  count: number;
  /** Unix ms timestamp marking the start of the active window. */
  windowStart: number;
}

export interface CounterStore {
  /**
   * Atomically record one request against `key` for a fixed window of `windowMs`,
   * evaluated at `nowMs`, and return the resulting count + window start. If the stored
   * window has expired (or none exists), the counter resets to 1 with a new window
   * starting at `nowMs`.
   */
  increment(key: string, windowMs: number, nowMs: number): Promise<CounterState>;
}
