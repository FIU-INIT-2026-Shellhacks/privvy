/**
 * Tests for GeminiProvider (Task 4). Mocked fetch + injected env; no live network.
 * Covers the behaviors the client's retry logic and the endpoint depend on:
 * success path, upstream failure mapping, unset-config, and key handling.
 */

import { assertEquals, assert } from '@std/assert';
import { GeminiProvider, LlmError } from './index.ts';

const env = (map: Record<string, string>) => (n: string) => map[n];

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const OK_BODY = { candidates: [{ content: { parts: [{ text: '  A tidy summary.  ' }] } }] };

Deno.test('success path returns trimmed tldr and the configured model', async () => {
  const provider = new GeminiProvider({
    getEnv: env({ GEMINI_MODEL: 'gemini-2.5-flash', GEMINI_API_KEY: 'secret-key' }),
    fetchImpl: (() => Promise.resolve(jsonResponse(OK_BODY))) as typeof fetch,
  });
  const res = await provider.summarize('policy text');
  assertEquals(res.tldr, 'A tidy summary.');
  assertEquals(res.model, 'gemini-2.5-flash');
});

Deno.test('HTTP error from Gemini maps to UPSTREAM', async () => {
  const provider = new GeminiProvider({
    getEnv: env({ GEMINI_MODEL: 'm', GEMINI_API_KEY: 'k' }),
    fetchImpl: (() => Promise.resolve(new Response('quota exceeded', { status: 429 }))) as typeof fetch,
  });
  const err = await provider.summarize('x').then(() => null, (e) => e);
  assert(err instanceof LlmError);
  assertEquals(err.code, 'UPSTREAM');
});

Deno.test('network failure / timeout maps to UPSTREAM', async () => {
  const provider = new GeminiProvider({
    getEnv: env({ GEMINI_MODEL: 'm', GEMINI_API_KEY: 'k' }),
    fetchImpl: (() => Promise.reject(new Error('network down'))) as typeof fetch,
  });
  const err = await provider.summarize('x').then(() => null, (e) => e);
  assert(err instanceof LlmError);
  assertEquals(err.code, 'UPSTREAM');
});

Deno.test('empty candidates maps to UPSTREAM', async () => {
  const provider = new GeminiProvider({
    getEnv: env({ GEMINI_MODEL: 'm', GEMINI_API_KEY: 'k' }),
    fetchImpl: (() => Promise.resolve(jsonResponse({ candidates: [] }))) as typeof fetch,
  });
  const err = await provider.summarize('x').then(() => null, (e) => e);
  assert(err instanceof LlmError);
  assertEquals(err.code, 'UPSTREAM');
});

Deno.test('unset GEMINI_MODEL fails as INTERNAL without calling fetch', async () => {
  let called = false;
  const provider = new GeminiProvider({
    getEnv: env({ GEMINI_API_KEY: 'k' }), // no GEMINI_MODEL
    fetchImpl: (() => {
      called = true;
      return Promise.resolve(jsonResponse(OK_BODY));
    }) as typeof fetch,
  });
  const err = await provider.summarize('x').then(() => null, (e) => e);
  assert(err instanceof LlmError);
  assertEquals(err.code, 'INTERNAL');
  assert(!called, 'must not attempt a Gemini call when the model is unset');
});

Deno.test('api key is sent in the x-goog-api-key header, not the URL', async () => {
  let seenUrl = '';
  let seenKeyHeader: string | null = null;
  const provider = new GeminiProvider({
    getEnv: env({ GEMINI_MODEL: 'm', GEMINI_API_KEY: 'secret-key' }),
    fetchImpl: ((url: string | URL | Request, init?: RequestInit) => {
      seenUrl = String(url);
      seenKeyHeader = new Headers(init?.headers).get('x-goog-api-key');
      return Promise.resolve(jsonResponse(OK_BODY));
    }) as typeof fetch,
  });
  await provider.summarize('x');
  assertEquals(seenKeyHeader, 'secret-key');
  assert(!seenUrl.includes('secret-key'), 'key must not appear in the request URL');
});
