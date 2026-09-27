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

  async put(policy: StoredPolicy): Promise<void> {
    // upsert on the content_hash primary key: idempotent if two requests race the same
    // miss (Req 4.5 dedup). Ignoring duplicates keeps the first stored analysis.
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
  }
}
