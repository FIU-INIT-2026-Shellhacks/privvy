/**
 * Per-IP rate limiter (Task 7).
 *
 * Fixed-window counter keyed by a keyed HMAC of the caller IP (never the raw IP), with
 * the window doubling as the retention TTL. Pure/injectable: the counter store, clock,
 * secret, and bounds are all passed in, so tests are deterministic and offline.
 *
 * Privacy Position scoping: the caller IP is processed ONLY here, only as an HMAC-SHA256
 * digest used as a counter key, and only for the window duration. The HMAC uses a
 * server-held secret so stored keys cannot be reverse-mapped to IPs by brute-forcing the
 * small IPv4 space (CodeRabbit: a plain unkeyed hash would be reversible). No raw IP is
 * stored; nothing is retained past the window. This is the single place IP is touched and
 * is explicitly outside the product's no-user-data guarantee (see design/req).
 */

import type { CounterStore } from './store.ts';

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
  store: CounterStore;
  /** Server-held secret for the keyed IP HMAC. */
  secret: string;
  /** Returns current time in unix ms. Injectable for deterministic tests. */
  now?: () => number;
}

/** Lowercase hex encoding of a byte buffer. */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const b of bytes) hex += b.toString(16).padStart(2, '0');
  return hex;
}

/**
 * Hash an IP into an opaque counter key using HMAC-SHA256 with a server-held secret.
 * Prefixed `rl_` so it is obviously not a raw IP. Because the digest is keyed, an
 * attacker who obtains stored keys cannot brute-force the (small) IPv4 space to recover
 * the originating IP without also knowing the secret.
 */
export async function ipKey(ip: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, enc.encode(`privvy-rl:${ip}`));
  return `rl_${toHex(sig)}`;
}

/**
 * Evaluate one request from `ip` against the limit. Increments the keyed-IP counter and
 * returns whether the request is allowed. The store enforces the fixed window; this
 * function owns the keyed hashing and the allow/deny math.
 */
export async function checkRateLimit(
  ip: string,
  config: RateLimitConfig,
  deps: RateLimiterDeps,
): Promise<RateLimitDecision> {
  const now = deps.now ?? (() => Date.now());
  const nowMs = now();
  const key = await ipKey(ip, deps.secret);

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
