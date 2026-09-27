/**
 * Supabase-backed CounterStore (Task 7): calls the atomic `rate_limit_hit` RPC on the
 * `rate_limit_counters` table. Uses the service_role client (the RPC's EXECUTE is granted
 * only to service_role; RLS on the table blocks anon/authenticated). Env-injected, and
 * injectable for tests.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { LlmError } from '../llm/provider.ts';
import { ErrorCode } from '../../../shared/dist/errors.js';
import type { CounterState, CounterStore } from './store.ts';

interface HitRow {
  count: number;
  window_start: string;
}

export interface SupabaseCounterStoreOptions {
  getEnv?: (name: string) => string | undefined;
  client?: SupabaseClient;
}

export class SupabaseCounterStore implements CounterStore {
  readonly #client: SupabaseClient;

  constructor(opts: SupabaseCounterStoreOptions = {}) {
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
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set for the rate limiter.',
      );
    }
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

  async increment(key: string, windowMs: number, nowMs: number): Promise<CounterState> {
    const { data, error } = await this.#client
      .rpc('rate_limit_hit', {
        p_key: key,
        p_window_ms: windowMs,
        p_now: new Date(nowMs).toISOString(),
      })
      .single<HitRow>();

    if (error || !data) {
      // Fail closed would block all traffic on a DB blip; fail open would remove the
      // limit. We surface INTERNAL and let the handler decide; the handler treats a
      // limiter error as non-fatal (allows the request) so a limiter outage never takes
      // the whole endpoint down — abuse protection degrades, availability does not.
      throw new LlmError(ErrorCode.INTERNAL, 'Rate limit check failed.', error);
    }
    return { count: data.count, windowStart: new Date(data.window_start).getTime() };
  }
}
