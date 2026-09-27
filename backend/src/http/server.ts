/**
 * Deno server entry for the /analyze Edge Function (Task 6 + Task 7).
 *
 * Wires the real SupabasePolicyStore + GeminiProvider + per-IP rate limiter and delegates
 * each request to the pure handler. Kept thin so the logic lives in handler.ts (testable
 * without network).
 *
 * Env (injected by the Edge runtime / project secrets): SUPABASE_URL,
 * SUPABASE_SERVICE_ROLE_KEY, GEMINI_MODEL, GEMINI_API_KEY, and optionally
 * RATE_LIMIT_WINDOW (seconds), RATE_LIMIT_MAX, RATE_LIMIT_SECRET.
 */

import { handleAnalyze } from './handler.ts';
import { SupabasePolicyStore } from '../cache/supabase-store.ts';
import { GeminiProvider } from '../llm/gemini.ts';
import { SupabaseCounterStore } from '../ratelimit/supabase-store.ts';
import { ENV, RATE_LIMIT_DEFAULTS } from '../../../shared/dist/config.js';

const env = (name: string): string | undefined => Deno.env.get(name);

/**
 * Parse an env var as a FINITE POSITIVE INTEGER, else fall back to `fallback`. Plain
 * `Number(x) || fallback` would accept negatives/fractions (e.g. RATE_LIMIT_MAX=-1),
 * which makes `count > maxRequests` always true and 429s every request — a
 * misconfiguration must not turn the limiter into a total outage.
 */
function positiveIntEnv(name: string, fallback: number): number {
  const parsed = Number(env(name));
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

const store = new SupabasePolicyStore();
const provider = new GeminiProvider();

// Rate-limit config from env, falling back to the shared defaults. The window env is in
// SECONDS (see .env.example); convert to ms for the limiter.
const windowSeconds = positiveIntEnv(ENV.RATE_LIMIT_WINDOW, RATE_LIMIT_DEFAULTS.WINDOW_SECONDS);
const maxRequests = positiveIntEnv(ENV.RATE_LIMIT_MAX, RATE_LIMIT_DEFAULTS.MAX_REQUESTS);
// Server-held secret for the keyed IP HMAC. If unset, fall back to the service-role key
// (also server-only and non-guessable) so the limiter is never silently unkeyed.
const rateLimitSecret = env('RATE_LIMIT_SECRET') || env('SUPABASE_SERVICE_ROLE_KEY') || '';

const rateLimit = {
  store: new SupabaseCounterStore(),
  config: { windowMs: windowSeconds * 1000, maxRequests },
  secret: rateLimitSecret,
};

Deno.serve((req: Request) => handleAnalyze(req, { store, provider, rateLimit }));
