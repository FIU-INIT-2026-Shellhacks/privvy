/**
 * Per-IP rate limiter (Task 7).
 *
 * Fixed-window counter keyed by a HASH of the caller IP (never the raw IP), with the
 * window doubling as the retention TTL. Pure/injectable: the counter store, clock, and
 * bounds are all passed in, so tests are deterministic and offline.
 *
 * Privacy Position scoping: the caller IP is processed ONLY here, only as a salted-ish
 * SHA-256 hash used as a counter key, and only for the window duration. No raw IP is
 * stored; nothing is retained past the window. This is the single place IP is touched
 * and is explicitly outside the product's no-user-data guarantee (see design/req).
 */

import { sha256Hex } from '../../../shared/dist/normalize.js';

export interface RateLimitConfig {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Max requests allowed per IP per window. */
  maxRequests: number;
}

export interface RateLimitDecision {
  /** True if this request is within the limit and may proceed. */
  allowed: boolean;
  /** Requests remaining in the current window (0 when blocked/at cap). */
  remaining: number;
  /** Seconds until the current window resets (for a Retry-After hint). */
  retryAfterSeconds: number;
}

export interface RateLimiterDeps {
  store: import('./store.ts').CounterStore;
  /** Returns current time in unix ms. Injectable for deterministic tests. */
  now?: () => number;
}

/**
 * Hash an IP into an opaque counter key. Prefixed so it is obviously not a raw IP and
 * cannot collide with other key spaces. The value stored/compared is only this hash.
 */
export async function ipKey(ip: string): Promise<string> {
  const digest = await sha256Hex(`privvy-rl:${ip}`);
  return `rl_${digest}`;
}

/**
 * Evaluate one request from `ip` against the limit. Increments the hashed-IP counter and
 * returns whether the request is allowed. The store enforces the fixed window; this
 * function owns the hashing and the allow/deny math.
 */
export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
  deps: RateLimiterDeps,
): Promise<RateLimitDecision> {
  const now = deps.now ?? (() => Date.now());
  const nowMs = now();
  const key = await ipKey(ip);

  const { count, windowStart } = await deps.store.increment(key, config.windowMs, nowMs);

  const elapsed = nowMs - windowStart;
  const msLeft = Math.max(0, config.windowMs - elapsed);
  const retryAfterSeconds = Math.ceil(msLeft / 1000);

  if (count > config.maxRequests) {
    return { allowed: false, remaining: 0, retryAfterSeconds };
  }
  return {
    allowed: true,
    remaining: Math.max(0, config.maxRequests - count),
    retryAfterSeconds,
  };
}
