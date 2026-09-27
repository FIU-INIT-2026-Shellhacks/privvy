/**
 * Backend /analyze client with client-owned retry (Task 12).
 *
 * Retry policy (decided with the team):
 * - Auto-retry ONLY transient upstream failures (typed `UPSTREAM`, or a network
 *   error / per-attempt timeout). Max 2 retries => up to 3 attempts total.
 * - NEVER auto-retry `RATE_LIMIT` — surface it to the popup's manual Retry button
 *   instead, so we don't add load to an already-throttled upstream.
 * - NEVER retry `VALIDATION` — it is deterministic; retrying cannot help.
 * - Each attempt has its own AbortController timeout so a hung request can't eat
 *   the whole (ephemeral) service-worker lifetime.
 * - Short exponential backoff WITH jitter, capped, total budget well under the
 *   ~30s MV3 worker idle teardown. No persistent / chrome.alarms retry.
 */

import {
  ErrorCode,
  isAnalyzeError,
  type AnalyzeRequest,
  type AnalyzeResponse,
  type AnalyzeSuccess,
} from '@privvy/shared';
import { ANALYZE_URL, ANALYZE_RETRY } from './config.js';

/** Normalized outcome the worker can turn into a popup message. */
export type AnalyzeOutcome =
  | { ok: true; result: AnalyzeSuccess }
  | { ok: false; message: string; retryable: boolean };

/** Sleep helper. */
function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Exponential backoff with full jitter, capped. attempt is 0-based (0 = before first retry). */
function backoffMs(attempt: number): number {
  const exp = ANALYZE_RETRY.BASE_BACKOFF_MS * 2 ** attempt;
  const capped = Math.min(exp, ANALYZE_RETRY.MAX_BACKOFF_MS);
  return Math.random() * capped; // full jitter in [0, capped)
}

/** Result of a single attempt, distinguishing retryable transient failures. */
type AttemptResult =
  | { kind: 'success'; result: AnalyzeSuccess }
  | { kind: 'transient'; message: string } // UPSTREAM / network / timeout -> may retry
  | { kind: 'terminal'; message: string; retryable: boolean }; // do not auto-retry

/** Perform one POST /analyze attempt with a per-attempt timeout. */
async function attempt(body: AnalyzeRequest): Promise<AttemptResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ANALYZE_RETRY.ATTEMPT_TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(ANALYZE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      credentials: 'omit',
      signal: controller.signal,
    });
  } catch {
    // Network failure or aborted-by-timeout: transient, worth retrying.
    return { kind: 'transient', message: "Couldn't reach Privvy." };
  } finally {
    clearTimeout(timer);
  }

  let parsed: AnalyzeResponse;
  try {
    parsed = (await res.json()) as AnalyzeResponse;
  } catch {
    // Non-JSON / unexpected: treat by status. 5xx transient, else terminal.
    if (res.status >= 500) return { kind: 'transient', message: 'Analysis failed.' };
    return { kind: 'terminal', message: 'Unexpected response from Privvy.', retryable: false };
  }

  if (!isAnalyzeError(parsed)) {
    // Only trust a non-error JSON body as success when the HTTP status is OK.
    // A 4xx/5xx that returns JSON without an `error` key (e.g. a proxy/gateway
    // error page) must NOT be read as an AnalyzeSuccess with an undefined tldr.
    if (res.ok) {
      return { kind: 'success', result: parsed };
    }
    if (res.status >= 500) return { kind: 'transient', message: 'Analysis failed.' };
    return { kind: 'terminal', message: 'Unexpected response from Privvy.', retryable: false };
  }

  // Typed error: decide retryability by code.
  switch (parsed.code) {
    case ErrorCode.UPSTREAM:
      return { kind: 'transient', message: parsed.error || 'Analysis failed.' };
    case ErrorCode.RATE_LIMIT:
      // Not auto-retried; the popup offers a manual retry.
      return { kind: 'terminal', message: parsed.error || 'Too many requests, try again shortly.', retryable: true };
    case ErrorCode.VALIDATION:
      return { kind: 'terminal', message: parsed.error || 'Invalid request.', retryable: false };
    case ErrorCode.INTERNAL:
    default:
      // Server-side internal error: let the user retry manually, but don't hammer automatically.
      return { kind: 'terminal', message: parsed.error || 'Something went wrong.', retryable: true };
  }
}

/**
 * Call /analyze with bounded automatic retry of transient upstream failures.
 * One layer of automatic retry: callers should invoke this once per user action;
 * the popup's manual Retry button starts a fresh call, not a retry-of-a-retry.
 */
export async function analyzeWithRetry(body: AnalyzeRequest): Promise<AnalyzeOutcome> {
  let lastTransient = 'Analysis failed.';

  for (let i = 0; i <= ANALYZE_RETRY.MAX_RETRIES; i++) {
    const r = await attempt(body);

    if (r.kind === 'success') {
      return { ok: true, result: r.result };
    }
    if (r.kind === 'terminal') {
      return { ok: false, message: r.message, retryable: r.retryable };
    }

    // transient: remember and, if attempts remain, back off then retry.
    lastTransient = r.message;
    if (i < ANALYZE_RETRY.MAX_RETRIES) {
      await delay(backoffMs(i));
    }
  }

  // Exhausted automatic retries on a transient failure -> offer manual retry.
  return { ok: false, message: `${lastTransient} Please try again.`, retryable: true };
}
