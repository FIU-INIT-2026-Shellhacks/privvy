/**
 * Build-time extension configuration.
 *
 * An MV3 extension is a static bundle with no runtime env, so the backend URL is
 * injected at build time via Vite's `define` (see vite.config.ts), sourced from
 * the PRIVVY_BACKEND_URL env var when building. The fallback is a placeholder so
 * the bundle still builds locally; the real deployed URL is set at build time.
 */

declare const __PRIVVY_BACKEND_URL__: string;

/** Base URL of the deployed backend that hosts /analyze. */
export const BACKEND_URL: string =
  typeof __PRIVVY_BACKEND_URL__ !== 'undefined' && __PRIVVY_BACKEND_URL__
    ? __PRIVVY_BACKEND_URL__
    : 'https://REPLACE_ME.functions.supabase.co';

/** Full URL of the /analyze endpoint. */
export const ANALYZE_URL = `${BACKEND_URL.replace(/\/$/, '')}/analyze`;

/** Retry/timeout tuning for the analyze call (client-owned retry policy). */
export const ANALYZE_RETRY = {
  /** Max automatic retries after the first attempt (so up to 3 attempts total). */
  MAX_RETRIES: 2,
  /** Per-attempt request timeout (ms) via AbortController. */
  ATTEMPT_TIMEOUT_MS: 12_000,
  /** Base backoff (ms) before the first retry; grows exponentially with jitter. */
  BASE_BACKOFF_MS: 500,
  /** Cap on any single backoff wait (ms), keeping total well within the MV3 worker lifetime. */
  MAX_BACKOFF_MS: 2_000,
} as const;
