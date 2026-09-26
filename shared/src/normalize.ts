/**
 * Text normalization + content hashing shared by both tracks.
 *
 * The content hash is the primary key of the `policies` cache table, so the server
 * (Track A) and the extension (Track B) MUST agree byte-for-byte. To guarantee that,
 * the normalization lives here in the shared package (a single implementation both
 * sides import) and the hash is SHA-256 over the UTF-8 bytes of the normalized text
 * via the Web Crypto API (`crypto.subtle`), which is present and identical in Deno and
 * in the browser/service worker. Same input -> same normalized string -> same hash on
 * both sides.
 */

/**
 * Normalize policy text so trivially different copies of the same policy hash equally.
 *
 * Rules (kept deliberately simple and deterministic):
 * - Normalize line endings (CRLF/CR -> LF) so platform differences don't change the hash.
 * - Collapse every run of whitespace (spaces, tabs, newlines) to a single space.
 * - Trim leading/trailing whitespace.
 *
 * Idempotent: normalize(normalize(x)) === normalize(x).
 */
export function normalizeText(input: string): string {
  return input
    .replace(/\r\n?/g, '\n')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lowercase hex encoding of a byte buffer. */
function toHex(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let hex = '';
  for (const b of bytes) {
    hex += b.toString(16).padStart(2, '0');
  }
  return hex;
}

/**
 * SHA-256 hex digest of the UTF-8 bytes of `text`, WITHOUT normalizing first.
 * Use when you already hold normalized text (e.g. re-hashing a received payload).
 */
export async function sha256Hex(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return toHex(digest);
}

/**
 * The content hash used as the cache key: normalize, then SHA-256 hex.
 * This is the canonical function both tracks call to derive `contentHash`.
 */
export async function contentHash(rawText: string): Promise<string> {
  return sha256Hex(normalizeText(rawText));
}
