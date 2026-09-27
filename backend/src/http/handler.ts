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
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;

/** Handle a single /analyze request and return a fully-formed Response. */
export async function handleAnalyze(req: Request, deps: HandlerDeps): Promise<Response> {
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
      return errorResponse(err.code, err.message);
    }
    // Unknown failure: do not leak internals to the client.
    return errorResponse(ErrorCode.INTERNAL, 'Unexpected server error.');
  }
}

/** Build a typed AnalyzeError JSON response with the mapped HTTP status. */
function errorResponse(
  code: (typeof ErrorCode)[keyof typeof ErrorCode],
  message: string,
): Response {
  const payload: AnalyzeError = { error: message, code };
  return new Response(JSON.stringify(payload), {
    status: ERROR_STATUS[code],
    headers: JSON_HEADERS,
  });
}
