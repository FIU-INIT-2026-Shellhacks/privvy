/**
 * Request validation for POST /analyze (Task 6).
 *
 * This is the PRIMARY request validator (the cache flow re-checks hash/URL as
 * defense-in-depth, but the authoritative rejection of bad input happens here). All
 * failures throw a typed LlmError(VALIDATION) so the handler maps them to 400 and never
 * calls the provider.
 *
 * Requirements: 5.1/5.2/5.3 (required fields, text bounds), 2.7 (URL sanitization:
 * https only, no query string or fragment), 3.3 (typed errors), 4.1 (contentHash parity).
 */

import { contentHash as hashOf } from '../../../shared/dist/normalize.js';
import { ErrorCode } from '../../../shared/dist/errors.js';
import { TEXT_BOUNDS } from '../../../shared/dist/config.js';
import { LlmError } from '../llm/provider.ts';

/** The validated, normalized request the handler passes to the cache flow. */
export interface ValidatedAnalyze {
  text: string;
  url: string;
  contentHash: string;
}

function fail(message: string): never {
  throw new LlmError(ErrorCode.VALIDATION, message);
}

/**
 * Validate a parsed JSON body into a ValidatedAnalyze, or throw LlmError(VALIDATION).
 *
 * - `text`: required string, non-empty after trim, within MAX_TEXT_CHARS.
 * - `url`: required string, parses as https, with no query string or fragment.
 * - `contentHash`: optional; if present must equal contentHash(text). When absent it is
 *   computed here so the flow always receives a hash bound to the text.
 */
export async function validateAnalyzeBody(
  body: unknown,
  maxTextChars: number = TEXT_BOUNDS.MAX_TEXT_CHARS,
): Promise<ValidatedAnalyze> {
  if (body === null || typeof body !== 'object') {
    fail('Request body must be a JSON object.');
  }
  const b = body as Record<string, unknown>;

  // text
  if (typeof b.text !== 'string') fail('`text` is required and must be a string.');
  const text = b.text;
  if (text.trim().length === 0) fail('`text` must not be empty.');
  if (text.length > maxTextChars) {
    fail(`\`text\` exceeds the maximum of ${maxTextChars} characters.`);
  }

  // url
  if (typeof b.url !== 'string') fail('`url` is required and must be a string.');
  const url = validateUrl(b.url);

  // contentHash (optional): verify parity, or compute it.
  const expected = await hashOf(text);
  if (b.contentHash !== undefined) {
    if (typeof b.contentHash !== 'string') fail('`contentHash` must be a string.');
    if (b.contentHash !== expected) fail('`contentHash` does not match `text`.');
  }

  return { text, url, contentHash: expected };
}

/** Validate and return an https URL with no query string or fragment. */
function validateUrl(raw: string): string {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    fail('`url` is not a valid URL.');
  }
  if (parsed.protocol !== 'https:') fail('`url` must use https.');
  if (parsed.search !== '' || parsed.hash !== '') {
    fail('`url` must not contain a query string or fragment.');
  }
  return raw;
}
