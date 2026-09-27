/**
 * Tests for the cache lookup + store flow (Task 5). In-memory fake store + spy provider;
 * no live DB. Covers Req 4.2 (hit = no provider call), 4.3 (miss stores), 5.5 (cached flag).
 */

import { assert, assertEquals } from '@std/assert';
import { analyzeCached } from './flow.ts';
import type { PolicyStore, StoredPolicy } from './store.ts';
import type { LlmProvider, Summary } from '../llm/provider.ts';

/** In-memory PolicyStore for tests. */
class FakeStore implements PolicyStore {
  readonly map = new Map<string, StoredPolicy>();
  putCalls = 0;
  get(hash: string): Promise<StoredPolicy | null> {
    return Promise.resolve(this.map.get(hash) ?? null);
  }
  put(p: StoredPolicy): Promise<void> {
    this.putCalls++;
    this.map.set(p.contentHash, p);
    return Promise.resolve();
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

const input = {
  contentHash: 'hash123',
  sourceUrl: 'https://example.com/privacy',
  text: 'normalized policy text',
};

Deno.test('cache miss invokes the provider once, persists, and returns cached=false', async () => {
  const store = new FakeStore();
  const provider = new SpyProvider();
  const res = await analyzeCached(input, { store, provider });

  assertEquals(provider.calls, 1, 'provider called exactly once on miss');
  assertEquals(store.putCalls, 1, 'result persisted on miss');
  assertEquals(res.cached, false);
  assertEquals(res.tldr, 'fresh summary');
  assertEquals(res.model, 'test-model');
  assertEquals(res.contentHash, 'hash123');
  // and the row is actually stored with the sanitized url
  assertEquals(store.map.get('hash123')?.sourceUrl, 'https://example.com/privacy');
});

Deno.test('cache hit returns stored analysis with cached=true and never calls the provider', async () => {
  const store = new FakeStore();
  store.map.set('hash123', {
    contentHash: 'hash123',
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
