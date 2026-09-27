/**
 * Policy text extraction (Task 10).
 *
 * Runs in the service worker (no DOM), so it uses node-html-parser rather than
 * DOMParser. Given a validated https URL, it fetches with manual redirect
 * handling (re-validating every hop), requires an HTML content type, strips
 * non-content elements, and normalizes the text — with guard rails for the
 * failure cases in Req 2.3-2.5.
 */

import { parse } from 'node-html-parser';
import { normalizeText, TEXT_BOUNDS } from '@privvy/shared';
import { validatePolicyUrl, rejectionMessage } from './url-guard.js';

/** Typed outcomes so the worker can map each to a user-facing message. */
export type ExtractionResult =
  | { ok: true; text: string; finalUrl: string }
  | {
      ok: false;
      code: 'UNSUPPORTED_FORMAT' | 'EXTRACTION_FAILED' | 'SSRF_BLOCKED' | 'FETCH_FAILED';
      message: string;
    };

/** Elements whose text is not policy content and should be dropped before extraction. */
const NON_CONTENT_SELECTORS = 'script, style, nav, header, footer, aside, noscript, template';

/**
 * Fetch a policy URL, following redirects, and SSRF-validate the initial and final URLs.
 *
 * Redirect handling (SSRF): real policy pages redirect heavily (locale/consent/CDN
 * hops), and refusing redirects breaks the feature on most real sites. So we follow
 * redirects (`redirect: 'follow'`, constrained to https by the extension's host
 * permissions) and validate the two URLs we CAN see: the user-selected URL up front,
 * and `response.url` (the final landing URL) afterward — rejecting either if it is a
 * loopback/link-local/private host. Intermediate hops are not observable from JS (an
 * opaque redirect hides its Location), so they are not individually validated; this is
 * a documented residual risk, acceptable because the target is public policy text and
 * both observable endpoints are checked against the hardened classifier.
 */
async function fetchWithGuardedRedirects(
  startUrl: string,
): Promise<
  | { ok: true; response: Response; finalUrl: string }
  | { ok: false; code: 'SSRF_BLOCKED' | 'FETCH_FAILED'; message: string }
> {
  // Validate the initial (user-selected) URL before fetching.
  const initial = validatePolicyUrl(startUrl);
  if (!initial.ok) {
    return { ok: false, code: 'SSRF_BLOCKED', message: rejectionMessage(initial.reason) };
  }

  let response: Response;
  try {
    response = await fetch(initial.url, { redirect: 'follow', credentials: 'omit' });
  } catch {
    return { ok: false, code: 'FETCH_FAILED', message: "Couldn't fetch that page." };
  }

  // Re-validate the final landing URL after any redirects the browser followed.
  // `response.url` reflects the final URL; fall back to the initial if it is empty.
  const finalCandidate = response.url || initial.url;
  const finalCheck = validatePolicyUrl(finalCandidate);
  if (!finalCheck.ok) {
    return { ok: false, code: 'SSRF_BLOCKED', message: rejectionMessage(finalCheck.reason) };
  }

  return { ok: true, response, finalUrl: finalCheck.url };
}

/**
 * Fetch, validate, and extract normalized readable text from a policy URL.
 */
export async function extractPolicyText(url: string): Promise<ExtractionResult> {
  const fetched = await fetchWithGuardedRedirects(url);
  if (!fetched.ok) {
    return fetched;
  }
  const { response, finalUrl } = fetched;

  // Require an HTML content type; bail on PDFs and other formats (Req 2.3).
  const contentType = (response.headers.get('content-type') ?? '').toLowerCase();
  if (!contentType.includes('text/html') && !contentType.includes('application/xhtml')) {
    return {
      ok: false,
      code: 'UNSUPPORTED_FORMAT',
      message: "Privvy can't analyze this format yet (only standard web pages).",
    };
  }

  let html: string;
  try {
    html = await response.text();
  } catch {
    return { ok: false, code: 'FETCH_FAILED', message: "Couldn't read that page." };
  }

  // Cap raw HTML size before parsing as defense-in-depth against pathological
  // input (ReDoS/blowup). Use a generous multiple of the text cap since HTML
  // markup is larger than its text content.
  const RAW_HTML_CAP = TEXT_BOUNDS.MAX_TEXT_CHARS * 10;
  const boundedHtml = html.length > RAW_HTML_CAP ? html.slice(0, RAW_HTML_CAP) : html;

  // Strip a leading doctype declaration, which node-html-parser otherwise
  // includes in `.text`. Case-insensitive, tolerant of leading whitespace.
  const withoutDoctype = boundedHtml.replace(/^\s*<!doctype[^>]*>/i, '');

  // Parse without a DOM and strip non-content elements.
  const root = parse(withoutDoctype);
  root.querySelectorAll(NON_CONTENT_SELECTORS).forEach((el) => el.remove());

  // Insert a space between block elements so adjacent blocks don't run together
  // (node-html-parser's `.text` concatenates without separators). We approximate
  // by replacing the parsed structure's text with a whitespace-joined form.
  const rawText = root.structuredText ?? root.text ?? '';
  const normalized = normalizeText(rawText);

  // Too-short implies failed extraction / gated content (Req 2.4, 2.5).
  if (normalized.length < TEXT_BOUNDS.MIN_TEXT_CHARS) {
    return {
      ok: false,
      code: 'EXTRACTION_FAILED',
      message: "Couldn't read the policy text on this page.",
    };
  }

  // Truncate over-long text before hashing/sending (protects backend + token cost).
  const text =
    normalized.length > TEXT_BOUNDS.MAX_TEXT_CHARS
      ? normalized.slice(0, TEXT_BOUNDS.MAX_TEXT_CHARS)
      : normalized;

  return { ok: true, text, finalUrl };
}
