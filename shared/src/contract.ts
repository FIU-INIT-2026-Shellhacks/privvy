/**
 * The /analyze request/response contract.
 *
 * This is the single shared interface between the extension (Track B) and the backend
 * (Track A). Changing it is a coordination point for both tracks.
 */

import type { ErrorCode } from './errors.js';

/**
 * Request body for POST /analyze.
 *
 * `text` is the normalized policy text. `url` is the sanitized source URL (origin +
 * path only — no query string or fragment). `contentHash` is optional; when present the
 * backend re-hashes `text` and rejects a mismatch, otherwise it computes the hash.
 */
export interface AnalyzeRequest {
  text: string;
  url: string;
  contentHash?: string;
}

/** Successful /analyze response. */
export interface AnalyzeSuccess {
  tldr: string;
  /** The model that produced the TLDR (value of GEMINI_MODEL at generation time). */
  model: string;
  /** True when served from the cache (no fresh Gemini call). */
  cached: boolean;
  contentHash: string;
}

/** Error /analyze response. */
export interface AnalyzeError {
  error: string;
  code: ErrorCode;
}

export type AnalyzeResponse = AnalyzeSuccess | AnalyzeError;

/** Narrows an AnalyzeResponse to the error variant. */
export function isAnalyzeError(res: AnalyzeResponse): res is AnalyzeError {
  return 'error' in res;
}
