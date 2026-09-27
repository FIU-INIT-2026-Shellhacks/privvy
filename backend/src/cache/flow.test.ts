/**
 * Tests for the cache lookup + store flow (Task 5). In-memory fake store + spy provider;
 * no live DB. Covers Req 4.2 (hit = no provider call), 4.3 (miss stores), 5.5 (cached
 * flag), plus the defense-in-depth invariants (hash binds to text; sanitized https URL).
 */

import { assert, assertEquals } from '@std/assert';
import { analyzeCached } from './flow.ts';
import type { PolicyStore, StoredPolicy } from './store.ts';
import type { LlmProvider, Summary } from '../llm/provider.ts';
import { LlmError } from '../llm/provider.ts';

/** In-memory PolicyStore for tests. */
class FakeStore implements PolicyStore {
  readonly map = new Map<string, StoredPolicy>();
  putCalls = 0;
  get(hash: string): Promise<StoredPolicy | null> {
    return Promise.resolve(this.map.get(hash) ?? null);
  }
  put(p: StoredPolicy): Promise<StoredPolicy> {
    this.putCalls++;
    // First write wins (mirrors upsert ignoreDuplicates); return the authoritative row.
    const existing = this.map.get(p.contentHash);
    if (existing) return Promise.resolve(existing);
    this.map.set(p.contentHash, p);
    return Promise.resolve(p);
  }
}

/** Provider that records how many times it was called. */
class SpyProvider implements LlmProvider {
  calls = 0;
  constructor(private readonly result: Summary = { tldr: 'fresh summary', model: 'test-model' }) {}
  summarize(_text: string): Promise<Summary> {
    this.calls++;
    return Promise.resolve(this.result);
  }
}

const TEXT = 'normalized policy text';
// Real contentHash(TEXT), so the flow's hash-binding check passes.
const HASH = 'b9d220c1e8e195de3f719bdd5d3a03816dea817b4f48324b8d3e5e8a7bd294b6';
const input = { contentHash: HASH, sourceUrl: 'https://example.com/privacy', text: TEXT };

Deno.test('cache miss invokes the provider once, persists, and returns cached=false', async () => {
  const store = new FakeStore();
  const provider = new SpyProvider();
  const res = await analyzeCached(input, { store, provider });

  assertEquals(provider.calls, 1, 'provider called exactly once on miss');
  assertEquals(store.putCalls, 1, 'result persisted on miss');
  assertEquals(res.cached, false);
  assertEquals(res.tldr, 'fresh summary');
  assertEquals(res.model, 'test-model');
  assertEquals(res.contentHash, HASH);
  assertEquals(store.map.get(HASH)?.sourceUrl, 'https://example.com/privacy');
});

Deno.test('cache hit returns stored analysis with cached=true and never calls the provider', async () => {
  const store = new FakeStore();
  store.map.set(HASH, {
    contentHash: HASH,
    sourceUrl: 'https://example.com/privacy',
    tldr: 'cached summary',
    model: 'cached-model',
  });
  const provider = new SpyProvider();

  const res = await analyzeCached(input, { store, provider });

  assertEquals(provider.calls, 0, 'provider MUST NOT be called on a hit');
  assertEquals(store.putCalls, 0, 'nothing re-stored on a hit');
  assertEquals(res.cached, true);
  assertEquals(res.tldr, 'cached summary');
  assertEquals(res.model, 'cached-model');
});

Deno.test('second call for the same hash hits the cache (miss then hit)', async () => {
  const store = new FakeStore();
  const provider = new SpyProvider();

  const first = await analyzeCached(input, { store, provider });
  const second = await analyzeCached(input, { store, provider });

  assertEquals(first.cached, false);
  assertEquals(second.cached, true);
  assertEquals(provider.calls, 1, 'provider called only on the first (miss)');
});

Deno.test('a provider failure is not cached (nothing stored)', async () => {
  const store = new FakeStore();
  const provider: LlmProvider = {
    summarize: () => Promise.reject(new Error('upstream boom')),
  };
  const err = await analyzeCached(input, { store, provider }).then(() => null, (e) => e);
  assert(err instanceof Error);
  assertEquals(store.putCalls, 0, 'failed summarization must not be persisted');
  assertEquals(store.map.size, 0);
});

Deno.test('a contentHash that does not match the text is rejected as VALIDATION (nothing stored, no provider call)', async () => {
  const store = new FakeStore();
  const provider = new SpyProvider();
  const bad = { ...input, contentHash: 'deadbeef' };
  const err = await analyzeCached(bad, { store, provider }).then(() => null, (e) => e);
  assert(err instanceof LlmError);
  assertEquals(err.code, 'VALIDATION');
  assertEquals(provider.calls, 0);
  assertEquals(store.putCalls, 0);
});

Deno.test('a non-https or query/fragment-bearing sourceUrl is rejected as VALIDATION', async () => {
  const store = new FakeStore();
  const provider = new SpyProvider();

  for (
    const badUrl of [
      'http://example.com/privacy',
      'https://example.com/p?token=abc',
      'https://example.com/p#frag',
    ]
  ) {
    const err = await analyzeCached({ ...input, sourceUrl: badUrl }, { store, provider })
      .then(() => null, (e) => e);
    assert(err instanceof LlmError, `expected LlmError for ${badUrl}`);
    assertEquals(err.code, 'VALIDATION');
  }
  assertEquals(provider.calls, 0);
  assertEquals(store.putCalls, 0);
});

Deno.test('concurrent miss on the same hash returns the summary that won the insert', async () => {
  const store = new FakeStore();
  // Pre-seed as if a racing request already stored its summary first.
  store.map.set(HASH, {
    contentHash: HASH,
    sourceUrl: 'https://example.com/privacy',
    tldr: 'winner summary',
    model: 'winner-model',
  });
  store.putCalls = 0;
  // This provider would produce a DIFFERENT summary...
  const provider = new SpyProvider({ tldr: 'loser summary', model: 'loser-model' });

  // ...but because the store already has the row, this is actually a HIT and returns the
  // winner. (The miss+put path is covered below via a store whose put returns the winner.)
  const res = await analyzeCached(input, { store, provider });
  assertEquals(res.tldr, 'winner summary');
  assertEquals(res.model, 'winner-model');
});

Deno.test('a miss whose put loses the race adopts the stored winner summary', async () => {
  // Store starts empty for get(), but its put() returns a pre-existing winner row,
  // simulating another request having inserted first between our get and put.
  const winner: StoredPolicy = {
    contentHash: HASH,
    sourceUrl: 'https://example.com/privacy',
    tldr: 'winner summary',
    model: 'winner-model',
  };
  const racingStore: PolicyStore = {
    get: () => Promise.resolve(null), // our lookup misses
    put: () => Promise.resolve(winner), // but the write loses; winner is authoritative
  };
  const provider = new SpyProvider({ tldr: 'loser summary', model: 'loser-model' });

  const res = await analyzeCached(input, { store: racingStore, provider });
  assertEquals(res.cached, false);
  assertEquals(res.tldr, 'winner summary', 'must return the stored winner, not our own summary');
  assertEquals(res.model, 'winner-model');
});
