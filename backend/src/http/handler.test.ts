/**
 * Tests for the /analyze handler (Task 6). Mock store + provider; no live DB or network.
 * Covers: happy path, missing/blank field, non-https + query/fragment url, oversized
 * text, mismatched contentHash, and a Gemini (UPSTREAM) failure mapping to 502.
 */

import { assertEquals } from '@std/assert';
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
