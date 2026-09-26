/**
 * Shared error codes for the /analyze contract.
 *
 * These are the only error codes the backend returns and the only ones the extension
 * needs to handle. Kept in the shared package so both tracks agree on the exact set.
 */

export const ErrorCode = {
  /** Request failed validation (missing fields, non-https url, query/fragment present). */
  VALIDATION: 'VALIDATION',
  /** Per-IP rate limit exceeded. */
  RATE_LIMIT: 'RATE_LIMIT',
  /** Upstream model (Gemini) call failed or timed out. */
  UPSTREAM: 'UPSTREAM',
  /** Unexpected server-side failure. */
  INTERNAL: 'INTERNAL',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/** HTTP status each error code maps to, per the design's interface contract. */
export const ERROR_STATUS: Record<ErrorCode, number> = {
  [ErrorCode.VALIDATION]: 400,
  [ErrorCode.RATE_LIMIT]: 429,
  [ErrorCode.UPSTREAM]: 502,
  [ErrorCode.INTERNAL]: 500,
};
