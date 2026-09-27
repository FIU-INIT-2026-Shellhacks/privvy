/**
 * Tests for the per-IP rate limiter (Task 7). In-memory fake fixed-window store +
 * injected clock, so everything is deterministic and offline. Covers: under-limit
 * passes, over-limit blocks (429 signal), window resets at TTL, and the stored key is a
 * HASH of the IP (never the raw IP).
 */

import { assert, assertEquals } from '@std/assert';
import { checkRateLimit, ipKey, type RateLimitConfig } from './limiter.ts';
import type { CounterState, CounterStore } from './store.ts';

/** In-memory fixed-window store mirroring the SQL rate_limit_hit semantics. */
class FakeCounterStore implements CounterStore {
  readonly rows = new Map<string, CounterState>();
  increment(key: string, windowMs: number, nowMs: number): Promise<CounterState> {
    const cur = this.rows.get(key);
    if (!cur || nowMs - cur.windowStart >= windowMs) {
      const fresh = { count: 1, windowStart: nowMs };
      this.rows.set(key, fresh);
      return Promise.resolve(fresh);
    }
    const next = { count: cur.count + 1, windowStart: cur.windowStart };
    this.rows.set(key, next);
    return Promise.resolve(next);
  }
}

const CONFIG: RateLimitConfig = { windowMs: 60_000, maxRequests: 3 };
const IP = '203.0.113.7';

Deno.test('requests under the limit are allowed', async () => {
  const store = new FakeCounterStore();
  const now = () => 1_000_000;
  for (let i = 0; i < CONFIG.maxRequests; i++) {
    const d = await checkRateLimit(IP, CONFIG, { store, now });
    assert(d.allowed, `request ${i + 1} should be allowed`);
  }
});

Deno.test('requests over the limit are blocked (429 signal)', async () => {
  const store = new FakeCounterStore();
  const now = () => 2_000_000;
  for (let i = 0; i < CONFIG.maxRequests; i++) {
    await checkRateLimit(IP, CONFIG, { store, now });
  }
  const over = await checkRateLimit(IP, CONFIG, { store, now });
  assertEquals(over.allowed, false);
  assertEquals(over.remaining, 0);
  assert(over.retryAfterSeconds > 0);
});

Deno.test('the window resets after the TTL elapses', async () => {
  const store = new FakeCounterStore();
  let t = 3_000_000;
  const now = () => t;
  for (let i = 0; i < CONFIG.maxRequests; i++) await checkRateLimit(IP, CONFIG, { store, now });
  assertEquals((await checkRateLimit(IP, CONFIG, { store, now })).allowed, false);
  // Advance past the window: the next request starts a fresh window and is allowed.
  t += CONFIG.windowMs + 1;
  const after = await checkRateLimit(IP, CONFIG, { store, now });
  assert(after.allowed, 'request after the window should be allowed again');
});

Deno.test('the stored counter key is a hash, not the raw IP', async () => {
  const store = new FakeCounterStore();
  await checkRateLimit(IP, CONFIG, { store, now: () => 4_000_000 });
  const keys = [...store.rows.keys()];
  assertEquals(keys.length, 1);
  const key = keys[0]!;
  assert(!key.includes(IP), 'raw IP must not appear in the stored key');
  assert(key.startsWith('rl_'), 'key should be the rl_<hash> form');
  // ipKey is deterministic and matches what was stored.
  assertEquals(key, await ipKey(IP));
});

Deno.test('different IPs get independent counters', async () => {
  const store = new FakeCounterStore();
  const now = () => 5_000_000;
  for (let i = 0; i < CONFIG.maxRequests; i++) {
    await checkRateLimit('1.1.1.1', CONFIG, { store, now });
  }
  // A different IP is still allowed even though the first is maxed out.
  const other = await checkRateLimit('2.2.2.2', CONFIG, { store, now });
  assert(other.allowed);
});
