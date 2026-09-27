/**
 * Tests for the /analyze handler (Task 6). Mock store + provider; no live DB or network.
 * Covers: happy path, missing/blank field, non-https + query/fragment url, oversized
 * text, mismatched contentHash, and a Gemini (UPSTREAM) failure mapping to 502.
 */

import { assert, assertEquals } from '@std/assert';
import { handleAnalyze } from './handler.ts';
import type { PolicyStore, StoredPolicy } from '../cache/store.ts';
import type { LlmProvider, Summary } from '../llm/provider.ts';
import { LlmError } from '../llm/provider.ts';
import { ErrorCode } from '../../../shared/dist/errors.js';

const TEXT = 'This is a sufficiently long policy text.';
const HASH = '5f6d4575db7dfe002c61f6f1d18e86db4603a57c6f583163357e548fd8956747';
const URL_OK = 'https://example.com/privacy';

class FakeStore implements PolicyStore {
  readonly map = new Map<string, StoredPolicy>();
  get(h: string): Promise<StoredPolicy | null> {
    return Promise.resolve(this.map.get(h) ?? null);
  }
  put(p: StoredPolicy): Promise<StoredPolicy> {
    const existing = this.map.get(p.contentHash);
    if (existing) return Promise.resolve(existing);
    this.map.set(p.contentHash, p);
    return Promise.resolve(p);
  }
}

class SpyProvider implements LlmProvider {
  calls = 0;
  constructor(private readonly result: Summary = { tldr: 'a summary', model: 'test-model' }) {}
  summarize(_t: string): Promise<Summary> {
    this.calls++;
    return Promise.resolve(this.result);
  }
}

/** Build a POST application/json Request for the analyze handler under test. */
function jsonRequest(body: unknown): Request {
  return new Request('https://fn/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  });
}

Deno.test('happy path: valid request returns 200 with tldr, model, cached=false, contentHash', async () => {
  const store = new FakeStore();
  const provider = new SpyProvider();
  const res = await handleAnalyze(jsonRequest({ text: TEXT, url: URL_OK }), { store, provider });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.tldr, 'a summary');
  assertEquals(body.model, 'test-model');
  assertEquals(body.cached, false);
  assertEquals(body.contentHash, HASH);
  assertEquals(provider.calls, 1);
});

Deno.test('a cache hit returns cached=true without calling the provider', async () => {
  const store = new FakeStore();
  store.map.set(HASH, {
    contentHash: HASH,
    sourceUrl: URL_OK,
    tldr: 'stored',
    model: 'stored-model',
  });
  const provider = new SpyProvider();
  const res = await handleAnalyze(jsonRequest({ text: TEXT, url: URL_OK }), { store, provider });
  assertEquals(res.status, 200);
  const body = await res.json();
  assertEquals(body.cached, true);
  assertEquals(body.tldr, 'stored');
  assertEquals(provider.calls, 0);
});

Deno.test('missing text -> 400 VALIDATION, no provider call', async () => {
  const provider = new SpyProvider();
  const res = await handleAnalyze(jsonRequest({ url: URL_OK }), {
    store: new FakeStore(),
    provider,
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, ErrorCode.VALIDATION);
  assertEquals(provider.calls, 0);
});

Deno.test('blank text -> 400 VALIDATION', async () => {
  const res = await handleAnalyze(jsonRequest({ text: '   ', url: URL_OK }), {
    store: new FakeStore(),
    provider: new SpyProvider(),
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, ErrorCode.VALIDATION);
});

Deno.test('non-https url -> 400 VALIDATION', async () => {
  const res = await handleAnalyze(jsonRequest({ text: TEXT, url: 'http://example.com/privacy' }), {
    store: new FakeStore(),
    provider: new SpyProvider(),
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, ErrorCode.VALIDATION);
});

Deno.test('url with query or fragment -> 400 VALIDATION', async () => {
  for (const url of ['https://example.com/p?token=abc', 'https://example.com/p#frag']) {
    const res = await handleAnalyze(jsonRequest({ text: TEXT, url }), {
      store: new FakeStore(),
      provider: new SpyProvider(),
    });
    assertEquals(res.status, 400, url);
    assertEquals((await res.json()).code, ErrorCode.VALIDATION);
  }
});

Deno.test('oversized text -> 400 VALIDATION', async () => {
  const big = 'x'.repeat(51);
  const res = await handleAnalyze(jsonRequest({ text: big, url: URL_OK }), {
    store: new FakeStore(),
    provider: new SpyProvider(),
    maxTextChars: 50,
  });
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, ErrorCode.VALIDATION);
});

Deno.test('mismatched contentHash -> 400 VALIDATION', async () => {
  const res = await handleAnalyze(
    jsonRequest({ text: TEXT, url: URL_OK, contentHash: 'deadbeef' }),
    { store: new FakeStore(), provider: new SpyProvider() },
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, ErrorCode.VALIDATION);
});

Deno.test('Gemini UPSTREAM failure -> 502', async () => {
  const provider: LlmProvider = {
    summarize: () => Promise.reject(new LlmError(ErrorCode.UPSTREAM, 'gemini down')),
  };
  const res = await handleAnalyze(jsonRequest({ text: TEXT, url: URL_OK }), {
    store: new FakeStore(),
    provider,
  });
  assertEquals(res.status, 502);
  assertEquals((await res.json()).code, ErrorCode.UPSTREAM);
});

Deno.test('non-POST -> 400 VALIDATION', async () => {
  const req = new Request('https://fn/analyze', { method: 'GET' });
  const res = await handleAnalyze(req, { store: new FakeStore(), provider: new SpyProvider() });
  assertEquals(res.status, 400);
});

Deno.test('non-JSON body -> 400 VALIDATION', async () => {
  const req = new Request('https://fn/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: 'not json',
  });
  const res = await handleAnalyze(req, { store: new FakeStore(), provider: new SpyProvider() });
  assertEquals(res.status, 400);
});

Deno.test('url with embedded credentials -> 400 VALIDATION', async () => {
  const res = await handleAnalyze(
    jsonRequest({ text: TEXT, url: 'https://user:pass@example.com/privacy' }),
    { store: new FakeStore(), provider: new SpyProvider() },
  );
  assertEquals(res.status, 400);
  assertEquals((await res.json()).code, ErrorCode.VALIDATION);
});

Deno.test('an INTERNAL LlmError does not leak its message to the client', async () => {
  const provider: LlmProvider = {
    summarize: () =>
      Promise.reject(new LlmError(ErrorCode.INTERNAL, 'SUPABASE_URL is not set: secret detail')),
  };
  const res = await handleAnalyze(jsonRequest({ text: TEXT, url: URL_OK }), {
    store: new FakeStore(),
    provider,
  });
  assertEquals(res.status, 500);
  const body = await res.json();
  assertEquals(body.code, ErrorCode.INTERNAL);
  assertEquals(body.error, 'Unexpected server error.');
});

// --- Rate limiting (Task 7) -------------------------------------------------

import type { CounterState, CounterStore } from '../ratelimit/store.ts';

const RL_SECRET = 'test-hmac-secret';
const RL_CONFIG = { windowMs: 60_000, maxRequests: 10 };
const RL_NOW = () => 1_000_000;

/** Over-limit within a VALID (non-expired) window: windowStart = now, count over max. */
const overLimitStore: CounterStore = {
  increment: (_k, _w, now): Promise<CounterState> =>
    Promise.resolve({ count: 999, windowStart: now }),
};
/** First request in a fresh window (under the limit). */
const underLimitStore: CounterStore = {
  increment: (_k, _w, now): Promise<CounterState> =>
    Promise.resolve({ count: 1, windowStart: now }),
};

/** A POST JSON request carrying a client IP header (so the limiter can identify it). */
function jsonRequestWithIp(body: unknown, ip = '203.0.113.7'): Request {
  return new Request('https://fn/analyze', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-forwarded-for': ip },
    body: JSON.stringify(body),
  });
}

Deno.test('over the rate limit -> 429 RATE_LIMIT with positive Retry-After, no provider call', async () => {
  const provider = new SpyProvider();
  const res = await handleAnalyze(jsonRequestWithIp({ text: TEXT, url: URL_OK }), {
    store: new FakeStore(),
    provider,
    rateLimit: { store: overLimitStore, config: RL_CONFIG, secret: RL_SECRET, now: RL_NOW },
  });
  assertEquals(res.status, 429);
  assertEquals((await res.json()).code, ErrorCode.RATE_LIMIT);
  const retryAfter = Number(res.headers.get('retry-after'));
  assert(retryAfter > 0, 'Retry-After should be a positive number of seconds');
  assertEquals(provider.calls, 0, 'blocked request must not reach the provider');
});

Deno.test('under the rate limit -> request proceeds normally', async () => {
  const provider = new SpyProvider();
  const res = await handleAnalyze(jsonRequestWithIp({ text: TEXT, url: URL_OK }), {
    store: new FakeStore(),
    provider,
    rateLimit: { store: underLimitStore, config: RL_CONFIG, secret: RL_SECRET, now: RL_NOW },
  });
  assertEquals(res.status, 200);
  assertEquals(provider.calls, 1);
});

Deno.test('the rate limit is checked BEFORE the method/content-type gates', async () => {
  // A non-POST request that is over the limit must get 429, not a 400 validation error,
  // and must still count (the limiter runs first).
  let calls = 0;
  const countingStore: CounterStore = {
    increment: (_k, _w, now): Promise<CounterState> => {
      calls++;
      return Promise.resolve({ count: 999, windowStart: now });
    },
  };
  const req = new Request('https://fn/analyze', {
    method: 'GET',
    headers: { 'x-forwarded-for': '203.0.113.7' },
  });
  const res = await handleAnalyze(req, {
    store: new FakeStore(),
    provider: new SpyProvider(),
    rateLimit: { store: countingStore, config: RL_CONFIG, secret: RL_SECRET, now: RL_NOW },
  });
  assertEquals(res.status, 429, 'over-limit non-POST should be 429, not 400');
  assertEquals(calls, 1, 'the limiter counted the request before the method gate');
});

Deno.test('a request with no IP header skips the limit (does not share one bucket)', async () => {
  // No x-forwarded-for / x-real-ip: the store must NOT be consulted (so header-less
  // callers are never bucketed together and 429'd by one abuser).
  let consulted = false;
  const spyStore: CounterStore = {
    increment: (_k, _w, now): Promise<CounterState> => {
      consulted = true;
      return Promise.resolve({ count: 999, windowStart: now });
    },
  };
  const res = await handleAnalyze(jsonRequest({ text: TEXT, url: URL_OK }), {
    store: new FakeStore(),
    provider: new SpyProvider(),
    rateLimit: { store: spyStore, config: RL_CONFIG, secret: RL_SECRET, now: RL_NOW },
  });
  assertEquals(res.status, 200, 'missing IP should proceed, not 429');
  assertEquals(consulted, false, 'a header-less request must not touch the shared counter');
});

Deno.test('a limiter store error fails open (request still proceeds)', async () => {
  const failingStore: CounterStore = {
    increment: () => Promise.reject(new Error('db down')),
  };
  const res = await handleAnalyze(jsonRequestWithIp({ text: TEXT, url: URL_OK }), {
    store: new FakeStore(),
    provider: new SpyProvider(),
    rateLimit: { store: failingStore, config: RL_CONFIG, secret: RL_SECRET, now: RL_NOW },
  });
  assertEquals(res.status, 200, 'a limiter outage must not take the endpoint down');
});
