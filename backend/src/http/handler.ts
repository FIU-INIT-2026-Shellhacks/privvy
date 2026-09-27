/**
 * POST /analyze request handler (Task 6): validate -> cache/store flow -> typed JSON.
 *
 * Pure and dependency-injected (store + provider) so it is testable without a live DB or
 * network. The Deno server entry (server.ts) wires the real SupabasePolicyStore and
 * GeminiProvider and hands each request here.
 *
 * Requirements: 5.1/5.2/5.3 (validation + response shape), 3.3 (typed errors ->
 * statuses), 4.2/4.3/5.5 (cache flow + `cached` flag), 2.7 (URL sanitization).
 */

import { ERROR_STATUS, ErrorCode } from '../../../shared/dist/errors.js';
import { analyzeCached } from '../cache/flow.ts';
import type { PolicyStore } from '../cache/store.ts';
import type { LlmProvider } from '../llm/provider.ts';
import { LlmError } from '../llm/provider.ts';
import { validateAnalyzeBody } from './validate.ts';
import { checkRateLimit, type RateLimitConfig } from '../ratelimit/limiter.ts';
import type { CounterStore } from '../ratelimit/store.ts';

/**
 * Response shapes, mirroring the shared /analyze contract (contract.ts). Declared locally
 * because Deno's .js/.d.ts resolution does not surface the shared interface types for a
 * type-only import here; the JSON produced is identical to AnalyzeSuccess/AnalyzeError.
 */
interface AnalyzeSuccess {
  tldr: string;
  model: string;
  cached: boolean;
  contentHash: string;
}
interface AnalyzeError {
  error: string;
  code: (typeof ErrorCode)[keyof typeof ErrorCode];
}

export interface HandlerDeps {
  store: PolicyStore;
  provider: LlmProvider;
  /** Max text length; defaults to the shared TEXT_BOUNDS in the validator. */
  maxTextChars?: number;
  /**
   * Optional per-IP rate limiting. When present, requests are checked before any
   * validation or provider work and blocked with RATE_LIMIT (429) when over the limit.
   * Omitted in unit tests that are not exercising the limiter.
   */
  rateLimit?: { store: CounterStore; config: RateLimitConfig; secret: string; now?: () => number };
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Handle a single /analyze request and return a fully-formed Response. */
export async function handleAnalyze(req: Request, deps: HandlerDeps): Promise<Response> {
  // Per-IP rate limit FIRST — before the method/content-type gates and any body work —
  // so the limit applies to EVERY analyze request (a malformed request still counts) and
  // an over-limit caller gets 429, not a validation error. A limiter failure is non-fatal
  // (fail open): an outage of the counter store degrades abuse protection but never takes
  // the endpoint down.
  if (deps.rateLimit) {
    const ip = clientIp(req);
    // Missing address policy: if we cannot identify the caller, do NOT bucket everyone
    // into a single shared counter (one abuser would 429 all header-less callers). Skip
    // the limit for that request instead. On Supabase's edge x-forwarded-for is present,
    // so this only affects unusual/misconfigured ingress.
    if (ip !== null) {
      try {
        const decision = await checkRateLimit(ip, deps.rateLimit.config, {
          store: deps.rateLimit.store,
          secret: deps.rateLimit.secret,
          now: deps.rateLimit.now,
        });
        if (!decision.allowed) {
          return errorResponse(
            ErrorCode.RATE_LIMIT,
            'Too many requests, try again shortly.',
            { 'retry-after': String(decision.retryAfterSeconds) },
          );
        }
      } catch {
        // Fail open: proceed without the limit rather than 500 the request.
      }
    }
  }

  // Method + content-type gate (VALIDATION -> 400).
  if (req.method !== 'POST') {
    return errorResponse(ErrorCode.VALIDATION, 'Method not allowed; use POST.');
  }
  const contentType = req.headers.get('content-type') ?? '';
  if (!contentType.toLowerCase().includes('application/json')) {
    return errorResponse(ErrorCode.VALIDATION, 'Content-Type must be application/json.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(ErrorCode.VALIDATION, 'Request body is not valid JSON.');
  }

  try {
    const { text, url, contentHash } = await validateAnalyzeBody(body, deps.maxTextChars);

    const result = await analyzeCached(
      { contentHash, sourceUrl: url, text },
      { store: deps.store, provider: deps.provider },
    );

    const success: AnalyzeSuccess = {
      tldr: result.tldr,
      model: result.model,
      cached: result.cached,
      contentHash: result.contentHash,
    };
    return new Response(JSON.stringify(success), { status: 200, headers: JSON_HEADERS });
  } catch (err) {
    if (err instanceof LlmError) {
      // INTERNAL messages can carry server-side detail (e.g. config/DB errors), so never
      // surface them; other codes (VALIDATION/RATE_LIMIT/UPSTREAM) are safe to relay.
      const message = err.code === ErrorCode.INTERNAL ? 'Unexpected server error.' : err.message;
      return errorResponse(err.code, message);
    }
    // Unknown failure: do not leak internals to the client.
    return errorResponse(ErrorCode.INTERNAL, 'Unexpected server error.');
  }
}

/** Build a typed AnalyzeError JSON response with the mapped HTTP status. */
function errorResponse(
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message: string,
  extraHeaders?: Record<string, string>,
): Response {
  const payload: AnalyzeError = { error: message, code };
  return new Response(JSON.stringify(payload), {
    status: ERROR_STATUS[code],
    headers: { ...JSON_HEADERS, ...extraHeaders },
  });
}

/**
 * Client IP from x-forwarded-for (Supabase edge sets it; first hop is the caller) or
 * x-real-ip. Returns null when neither is present, so the caller can skip the limit
 * rather than bucket all header-less callers into one shared counter. Only ever hashed
 * downstream — never stored raw.
 */
function clientIp(req: Request): string | null {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) {
    const first = xff.split(',')[0]?.trim();
    if (first) return first;
  }
  const real = req.headers.get('x-real-ip')?.trim();
  return real || null;
}
