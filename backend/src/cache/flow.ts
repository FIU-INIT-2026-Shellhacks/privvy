/**
 * Cache lookup + store flow (Task 5).
 *
 * Given a content hash and the policy text: on a cache HIT, return the stored analysis
 * with `cached: true` and DO NOT call the provider. On a MISS, call the LlmProvider
 * once, persist the row, and return it with `cached: false`.
 *
 * Requirements: 4.2 (return cached on hit, no model call), 4.3 (store on miss),
 * 5.5 (`cached` flag reflects hit/miss accurately).
 *
 * Defense-in-depth: the flow validates its own invariants before touching the store or
 * provider — the supplied contentHash MUST re-hash from `text`, and `sourceUrl` MUST be
 * https with no query/fragment. The `/analyze` endpoint (Task 6) performs the primary
 * request validation, but binding the hash to the text and re-checking the URL here
 * ensures nothing can persist under a mismatched key or store an unsanitized URL even if
 * this flow is invoked directly (semantic review finding).
 */

import { contentHash as hashOf } from '../../../shared/dist/normalize.js';
import { ErrorCode } from '../../../shared/dist/errors.js';
import { LlmError, type LlmProvider } from '../llm/provider.ts';
import type { PolicyStore } from './store.ts';

/** A resolved analysis plus whether it came from the cache. */
export interface AnalysisResult {
  contentHash: string;
  tldr: string;
  model: string;
  cached: boolean;
}

export interface AnalyzeCachedInput {
  /** Content hash (cache key). Must equal contentHash(text). */
  contentHash: string;
  /** Sanitized source URL (origin + path only, https) — stored on a miss. */
  sourceUrl: string;
  /** Normalized policy text — sent to the provider only on a miss. */
  text: string;
}

/**
 * Resolve an analysis through the cache.
 *
 * On hit: returns the stored row as `cached: true`; the provider is never invoked.
 * On miss: invokes `provider.summarize(text)` exactly once, stores the result keyed by
 * the content hash, and returns it as `cached: false`. Provider errors propagate
 * (typed LlmError) — a failed summarization is not cached.
 *
 * Throws `LlmError(VALIDATION)` if the hash does not bind to the text or the URL is not
 * a sanitized https origin+path.
 */
export async function analyzeCached(
  input: AnalyzeCachedInput,
  deps: { store: PolicyStore; provider: LlmProvider },
): Promise<AnalysisResult> {
  const { contentHash, sourceUrl, text } = input;
  const { store, provider } = deps;

  // Bind the key to the content: a supplied hash that does not re-hash from `text` would
  // let an analysis be stored/served under the wrong key. Reject rather than trust it.
  const expected = await hashOf(text);
  if (contentHash !== expected) {
    throw new LlmError(
      ErrorCode.VALIDATION,
      'contentHash does not match the provided text.',
    );
  }

  // Re-assert the sanitized-URL invariant (https, no query/fragment) before it is stored.
  assertSanitizedHttpsUrl(sourceUrl);

  const hit = await store.get(contentHash);
  if (hit) {
    // HIT: no provider call (Req 4.2).
    return {
      contentHash: hit.contentHash,
      tldr: hit.tldr,
      model: hit.model,
      cached: true,
    };
  }

  // MISS: summarize once (Req 4.3). If this throws, nothing is stored.
  const { tldr, model } = await provider.summarize(text);

  await store.put({ contentHash, sourceUrl, tldr, model });

  return { contentHash, tldr, model, cached: false };
}

/** Throws LlmError(VALIDATION) unless url is https with no query string or fragment. */
function assertSanitizedHttpsUrl(url: string): void {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new LlmError(ErrorCode.VALIDATION, 'sourceUrl is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') {
    throw new LlmError(ErrorCode.VALIDATION, 'sourceUrl must be https.');
  }
  if (parsed.search !== '' || parsed.hash !== '') {
    throw new LlmError(
      ErrorCode.VALIDATION,
      'sourceUrl must not contain a query string or fragment.',
    );
  }
}
