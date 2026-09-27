/**
 * Supabase-backed PolicyStore (Task 5): reads/writes the `policies` table.
 *
 * Uses the service_role key, which bypasses the Row Level Security enabled in decision
 * #11 (RLS on, no policies) — this server-side function is the ONLY authorized reader
 * and writer of the table. SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are injected by
 * the Supabase Edge runtime; both readers are injectable for tests.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LlmError } from '../llm/provider.ts';
import { ErrorCode } from '../../../shared/dist/errors.js';
import type { PolicyStore, StoredPolicy } from './store.ts';

const TABLE = 'policies';

/** Row shape as stored in Postgres (snake_case columns). */
interface PolicyRow {
  content_hash: string;
  source_url: string;
  tldr: string;
  model: string;
}

export interface SupabaseStoreOptions {
  /** Env reader; defaults to Deno.env.get. Injectable for tests. */
  getEnv?: (name: string) => string | undefined;
  /** Pre-built client (injectable for tests); constructed from env when omitted. */
  client?: SupabaseClient;
}

export class SupabasePolicyStore implements PolicyStore {
  readonly #client: SupabaseClient;

  constructor(opts: SupabaseStoreOptions = {}) {
    if (opts.client) {
      this.#client = opts.client;
      return;
    }
    const getEnv = opts.getEnv ??
      ((name: string) =>
        (globalThis as { Deno?: { env: { get(n: string): string | undefined } } }).Deno?.env.get(
          name,
        ));
    const url = getEnv('SUPABASE_URL');
    const key = getEnv('SUPABASE_SERVICE_ROLE_KEY');
    if (!url || !key) {
      throw new LlmError(
        ErrorCode.INTERNAL,
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the policy store.',
      );
    }
    // The service_role credential is highly privileged, so refuse to send it over an
    // insecure or non-URL endpoint even if the injected env is misconfigured. The
    // Supabase Edge runtime provides an https SUPABASE_URL; anything else is rejected.
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new LlmError(ErrorCode.INTERNAL, 'SUPABASE_URL is not a valid URL.');
    }
    if (parsed.protocol !== 'https:') {
      throw new LlmError(ErrorCode.INTERNAL, 'SUPABASE_URL must use https.');
    }
    this.#client = createClient(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  async get(contentHash: string): Promise<StoredPolicy | null> {
    const { data, error } = await this.#client
      .from(TABLE)
      .select('content_hash, source_url, tldr, model')
      .eq('content_hash', contentHash)
      .maybeSingle<PolicyRow>();

    if (error) {
      throw new LlmError(ErrorCode.INTERNAL, 'Cache lookup failed.', error);
    }
    if (!data) return null;
    return {
      contentHash: data.content_hash,
      sourceUrl: data.source_url,
      tldr: data.tldr,
      model: data.model,
    };
  }

  async put(policy: StoredPolicy): Promise<StoredPolicy> {
    // upsert on the content_hash primary key: idempotent if two requests race the same
    // miss (Req 4.5 dedup). ignoreDuplicates keeps the FIRST stored analysis.
    const row: PolicyRow = {
      content_hash: policy.contentHash,
      source_url: policy.sourceUrl,
      tldr: policy.tldr,
      model: policy.model,
    };
    const { error } = await this.#client
      .from(TABLE)
      .upsert(row, { onConflict: 'content_hash', ignoreDuplicates: true });

    if (error) {
      throw new LlmError(ErrorCode.INTERNAL, 'Cache store failed.', error);
    }

    // Read back the row that is now authoritative for this hash. With ignoreDuplicates an
    // upsert that lost a concurrent race writes nothing and returns no row, so we always
    // re-read to return the winning summary (not necessarily the one we just tried to
    // write). This keeps concurrent and later callers consistent.
    const stored = await this.get(policy.contentHash);
    // Fallback to the submitted row only if the read unexpectedly finds nothing (should
    // not happen after a successful upsert, but avoids returning null on a transient gap).
    return stored ?? policy;
  }
}
