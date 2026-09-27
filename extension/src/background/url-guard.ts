/**
 * SSRF guard + URL sanitization (Task 10).
 *
 * The service worker is authorized to fetch anywhere `host_permissions` allows,
 * and the URL it fetches originates from page-controlled content. So every URL
 * — the initial one and every redirect hop — must be validated before we fetch
 * it, to stop a page from steering the worker at internal/private endpoints.
 *
 * Rules (from the design's SSRF guard):
 * - Require https.
 * - Reject loopback, link-local, and private-network hosts.
 * - Sanitize: keep origin + path only; strip query string and fragment.
 */

/** Reason a URL was rejected, for logging/messaging (never leaks the raw value). */
export type UrlRejectReason =
  | 'unparseable'
  | 'not-https'
  | 'loopback'
  | 'link-local'
  | 'private-network'
  | 'disallowed-host';

export interface UrlValidationOk {
  ok: true;
  /** Sanitized URL: origin + path only, no query or fragment. */
  url: string;
}
export interface UrlValidationErr {
  ok: false;
  reason: UrlRejectReason;
}
export type UrlValidation = UrlValidationOk | UrlValidationErr;

/** Hostnames that always denote the local machine. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

/**
 * Decide whether a hostname is a private/loopback/link-local target that must be
 * rejected. Handles IPv4 literals, IPv6 literals (in brackets), and obvious
 * hostname cases. Non-IP hostnames (normal domains) pass this check; DNS
 * rebinding is out of scope for the MVP (documented limitation).
 */
function classifyHost(hostname: string): UrlRejectReason | null {
  const host = hostname.toLowerCase();

  if (LOOPBACK_HOSTNAMES.has(host)) return 'loopback';

  // `.localhost` TLD and common internal suffixes.
  if (host === 'localhost' || host.endsWith('.localhost')) return 'loopback';

  // IPv6 literal, e.g. "[fe80::1]" or "[::1]".
  if (host.startsWith('[') && host.endsWith(']')) {
    return classifyIpv6(host.slice(1, -1));
  }

  // IPv4 literal check.
  const v4 = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) {
    return classifyIpv4(
      Number(v4[1]),
      Number(v4[2]),
      Number(v4[3]),
      Number(v4[4]),
    );
  }

  return null;
}

/** Classify an IPv4 address (given its four octets) against blocked ranges. */
function classifyIpv4(a: number, b: number, c: number, d: number): UrlRejectReason | null {
  if ([a, b, c, d].some((o) => Number.isNaN(o) || o < 0 || o > 255)) return 'disallowed-host';
  if (a === 0) return 'disallowed-host'; // 0.0.0.0/8 ("this network")
  if (a === 127) return 'loopback'; // 127.0.0.0/8
  if (a === 169 && b === 254) return 'link-local'; // 169.254.0.0/16
  if (a === 10) return 'private-network'; // 10.0.0.0/8
  if (a === 172 && b >= 16 && b <= 31) return 'private-network'; // 172.16.0.0/12
  if (a === 192 && b === 168) return 'private-network'; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return 'private-network'; // 100.64.0.0/10 CGNAT
  if (a >= 224 && a <= 239) return 'disallowed-host'; // 224.0.0.0/4 multicast
  if (a >= 240) return 'disallowed-host'; // 240.0.0.0/4 reserved (incl. 255.255.255.255)
  return null;
}

/**
 * Classify an IPv6 address literal (without brackets) against blocked ranges.
 * Handles the full link-local block, ULA, loopback/unspecified, and
 * IPv4-mapped forms (both dotted `::ffff:127.0.0.1` and the hex `::ffff:7f00:1`
 * form the WHATWG URL parser normalizes to).
 */
function classifyIpv6(innerRaw: string): UrlRejectReason | null {
  const inner = innerRaw.toLowerCase();

  if (inner === '::1') return 'loopback';
  if (inner === '::') return 'disallowed-host'; // unspecified address

  // Link-local fe80::/10 spans first-hextet fe80–febf (i.e. fe8x/fe9x/feax/febx),
  // NOT just fe80.
  const firstHextet = inner.split(':')[0] ?? '';
  if (/^fe[89ab]/.test(firstHextet)) return 'link-local';
  // Unique local fc00::/7 (fc/fd).
  if (firstHextet.startsWith('fc') || firstHextet.startsWith('fd')) return 'private-network';

  // IPv4-mapped / -compatible: extract the embedded IPv4 and classify it.
  // Dotted form, e.g. "::ffff:127.0.0.1" or "::127.0.0.1".
  const dotted = inner.match(/(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (dotted) {
    return classifyIpv4(
      Number(dotted[1]),
      Number(dotted[2]),
      Number(dotted[3]),
      Number(dotted[4]),
    );
  }
  // Hex-mapped form the URL parser produces, e.g. "::ffff:7f00:1" (127.0.0.1).
  const hexMapped = inner.match(/::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hexMapped) {
    const hi = parseInt(hexMapped[1] as string, 16);
    const lo = parseInt(hexMapped[2] as string, 16);
    return classifyIpv4((hi >> 8) & 0xff, hi & 0xff, (lo >> 8) & 0xff, lo & 0xff);
  }

  return null;
}

/**
 * Validate and sanitize a candidate policy URL.
 *
 * @returns `{ ok: true, url }` with the sanitized (origin + path) URL, or
 *          `{ ok: false, reason }` if it must not be fetched.
 */
export function validatePolicyUrl(candidate: string): UrlValidation {
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    return { ok: false, reason: 'unparseable' };
  }

  if (parsed.protocol !== 'https:') {
    return { ok: false, reason: 'not-https' };
  }

  const hostReason = classifyHost(parsed.hostname);
  if (hostReason) {
    return { ok: false, reason: hostReason };
  }

  // Sanitize: origin + pathname only. Drop search (query) and hash (fragment).
  const sanitized = `${parsed.origin}${parsed.pathname}`;
  return { ok: true, url: sanitized };
}

/** Human-readable message for a rejection reason (safe to show; no raw URL). */
export function rejectionMessage(reason: UrlRejectReason): string {
  switch (reason) {
    case 'not-https':
      return 'Privvy only analyzes policies served over HTTPS.';
    case 'loopback':
    case 'link-local':
    case 'private-network':
      return 'That link points to a private or local address, which Privvy will not fetch.';
    case 'unparseable':
      return "That link isn't a valid URL.";
    case 'disallowed-host':
      return 'That link points to a disallowed address.';
  }
}
