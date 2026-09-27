/**
 * Policy-link detection (Task 9).
 *
 * Pure DOM-scanning logic, split out from the content-script entry so it is easy
 * to reason about and reuse. Given a document, it finds anchors that look like
 * privacy-policy or terms links, resolves them to absolute URLs, and
 * deduplicates by resolved URL.
 *
 * Detection only: this never fetches or extracts. The page-derived list it
 * returns is untrusted; nothing is fetched until the user selects a link.
 */

import type { DetectedLink } from '../types/messages.js';

/**
 * Keyword phrases that indicate a policy document. Matched case-insensitively
 * against both the anchor's visible text and its href. Kept as phrases (not bare
 * words) to avoid matching unrelated links that merely contain "terms" or
 * "privacy" in isolation.
 */
const POLICY_KEYWORDS: readonly string[] = [
  'privacy policy',
  'privacy notice',
  'privacy statement',
  'terms of service',
  'terms of use',
  'terms and conditions',
  'terms & conditions',
  'terms + conditions',
  'cookie policy',
];

/**
 * Normalize a string for keyword matching: lowercase, and collapse runs of
 * whitespace so "Privacy\n  Policy" matches "privacy policy".
 */
function normalize(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Normalize an href for keyword matching. URL paths use hyphens/underscores as
 * word separators, so treat them as spaces ("/privacy-policy" -> "privacy policy").
 */
function normalizeHref(href: string): string {
  return href.toLowerCase().replace(/[-_/]+/g, ' ').replace(/\s+/g, ' ').trim();
}

/** True if either the link text or the href contains any policy keyword phrase. */
function looksLikePolicyLink(text: string, href: string): boolean {
  const haystackText = normalize(text);
  const haystackHref = normalizeHref(href);
  return POLICY_KEYWORDS.some(
    (kw) => haystackText.includes(kw) || haystackHref.includes(kw),
  );
}

/**
 * Scan a document for policy links.
 *
 * @param doc The document to scan (defaults to the live `document`).
 * @returns Distinct detected links, deduplicated by resolved absolute URL.
 */
export function detectPolicyLinks(doc: Document = document): DetectedLink[] {
  const anchors = Array.from(doc.querySelectorAll('a[href]'));
  const byUrl = new Map<string, DetectedLink>();

  for (const anchor of anchors) {
    const rawHref = anchor.getAttribute('href');
    if (!rawHref) continue;

    // Skip non-navigational hrefs outright.
    const lowered = rawHref.trim().toLowerCase();
    if (
      lowered === '' ||
      lowered === '#' ||
      lowered.startsWith('javascript:') ||
      lowered.startsWith('mailto:') ||
      lowered.startsWith('tel:')
    ) {
      continue;
    }

    const text = (anchor.textContent ?? '').trim();
    if (!looksLikePolicyLink(text, rawHref)) continue;

    // Resolve to an absolute URL against the page as base. Skip anything that
    // fails to parse.
    let resolved: string;
    try {
      resolved = new URL(rawHref, doc.baseURI).href;
    } catch {
      continue;
    }

    // Deduplicate by resolved URL; keep the first occurrence's text, but prefer
    // a non-empty text over an empty one if a later duplicate has better text.
    const existing = byUrl.get(resolved);
    if (!existing) {
      byUrl.set(resolved, { url: resolved, text: text || resolved });
    } else if (!existing.text && text) {
      existing.text = text;
    }
  }

  return Array.from(byUrl.values());
}
