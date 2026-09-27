/**
 * Deno server entry for the /analyze Edge Function (Task 6).
 *
 * Wires the real SupabasePolicyStore + GeminiProvider and delegates each request to the
 * pure handler. Kept thin so the logic lives in handler.ts (testable without network).
 */

import { handleAnalyze } from './handler.ts';
import { SupabasePolicyStore } from '../cache/supabase-store.ts';
import { GeminiProvider } from '../llm/gemini.ts';

// Constructed once per isolate. Env (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
// GEMINI_MODEL, GEMINI_API_KEY) is read from the Edge runtime.
const store = new SupabasePolicyStore();
const provider = new GeminiProvider();

Deno.serve((req: Request) => handleAnalyze(req, { store, provider }));
