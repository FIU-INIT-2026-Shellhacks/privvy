/**
 * PolicyStore: the narrow persistence contract for the content-hash cache (Task 5).
 *
 * The cache flow depends only on this interface, never on a concrete DB client, so the
 * flow stays unit-testable with an in-memory fake and the Supabase-backed impl lives in
 * one place (supabase-store.ts). Mirrors the swappable LlmProvider seam from Task 4.
 */

/** A stored policy analysis row (mirrors the `policies` table; no user/identity data). */
export interface StoredPolicy {
  /** SHA-256 hex of normalized policy text; the cache key / table primary key. */
  contentHash: string;
  /** Sanitized source URL (origin + path only). */
  sourceUrl: string;
  /** Plain-English TLDR. */
  tldr: string;
  /** Model that produced the TLDR. */
  model: string;
}

export interface PolicyStore {
  /** Return the stored analysis for a content hash, or null on a cache miss. */
  get(contentHash: string): Promise<StoredPolicy | null>;
  /** Persist an analysis. Idempotent on the content_hash primary key. */
  put(policy: StoredPolicy): Promise<void>;
}
