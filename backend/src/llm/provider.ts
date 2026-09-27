/**
 * LLM provider interface (Task 4).
 *
 * Isolates the model call behind a narrow contract so the model/vendor is swappable
 * (design Non-Goal 6). The `/analyze` endpoint (Task 6) and cache flow (Task 5) depend
 * only on this interface, never on GeminiProvider directly.
 *
 * Failure model (Option A — fail fast, no server-side retry): any upstream error or
 * timeout is thrown as a typed `LlmError` carrying `ErrorCode.UPSTREAM`, and an unset
 * `GEMINI_MODEL` is thrown as `ErrorCode.INTERNAL` (a config/deploy mistake, not an
 * upstream fault). Retry policy lives on the client (Tasks 12/13), which branches on
 * these codes; the server just surfaces a well-defined failure.
 */

import { ErrorCode } from '../../../shared/dist/errors.js';

/** The set of error codes, derived from the shared value (see errors.ts). */
type ErrorCodeValue = (typeof ErrorCode)[keyof typeof ErrorCode];

/** Result of a successful summarization. */
export interface Summary {
  /** Plain-English TLDR of the policy text. */
  tldr: string;
  /** The model that produced the TLDR (value of GEMINI_MODEL at call time). */
  model: string;
}

/** The swappable model-call contract. */
export interface LlmProvider {
  /** Summarize policy text into a plain-English TLDR, or throw an LlmError. */
  summarize(policyText: string): Promise<Summary>;
}

/**
 * Typed provider failure. `code` is one of the shared ErrorCode values so the endpoint
 * can map it straight to an HTTP status and the client can branch on it.
 */
export class LlmError extends Error {
  readonly code: ErrorCodeValue;
  /** Optional underlying cause, kept for server logs (never returned to the client). */
  override readonly cause?: unknown;

  constructor(code: ErrorCodeValue, message: string, cause?: unknown) {
    super(message);
    this.name = 'LlmError';
    this.code = code;
    this.cause = cause;
  }
}
