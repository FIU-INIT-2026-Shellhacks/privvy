/**
 * Cache lookup + store flow (Task 5).
 *
 * Given a content hash and the policy text: on a cache HIT, return the stored analysis
 * with `cached: true` and DO NOT call the provider. On a MISS, call the LlmProvider
 * once, persist the row, and return it with `cached: false`.
 *
 * Requirements: 4.2 (return cached on hit, no model call), 4.3 (store on miss),
 * 5.5 (`cached` flag reflects hit/miss accurately).
 */

import type { LlmProvider } from '../llm/provider.ts';
import type { PolicyStore } from './store.ts';

/** A resolved analysis plus whether it came from the cache. */
export interface AnalysisResult {
  contentHash: string;
  tldr: string;
  model: string;
  cached: boolean;
}

export interface AnalyzeCachedInput {
  /** Content hash (cache key). */
  contentHash: string;
  /** Sanitized source URL (origin + path only) — stored on a miss. */
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
 */
export async function analyzeCached(
  input: AnalyzeCachedInput,
  deps: { store: PolicyStore; provider: LlmProvider },
): Promise<AnalysisResult> {
  const { contentHash, sourceUrl, text } = input;
  const { store, provider } = deps;

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
