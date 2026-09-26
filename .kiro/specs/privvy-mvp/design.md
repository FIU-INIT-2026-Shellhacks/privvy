# Privvy MVP — Design

## Overview

Privvy is a Chrome Manifest V3 extension plus a thin Supabase Edge Function backend. The
extension detects policy links on the current page, fetches and extracts the policy
text in the user's own browser, hashes it, and sends the text to the backend. The
backend checks a content-hash cache and, on a miss, calls the Gemini API to produce a
plain-English TLDR, stores it, and returns it. All processed content is public legal
text; no user identity or personal data is ever transmitted or stored.

This design realizes the MVP pipeline: **detect -> extract -> summarize -> cache**,
triggered manually. It follows the decisions locked in requirements: Chrome, TypeScript
everywhere, Gemini via a swappable provider, content-hash cache, no user data, and
Option 1 for fetching (extension fetches and extracts; backend receives only text).

## Architecture

```
+------------------------------------------------------------+
|                     Chrome Extension (MV3, TS)             |
|                                                            |
|  Popup UI            Service Worker         Content Script |
|  (results/errors) <-> (orchestrator,   <->  (detection,    |
|                        hashing, fetch)      extraction)    |
+---------------------------------|--------------------------+
                                  | HTTPS (TLS), text + url only
                                  v
+------------------------------------------------------------+
|            Supabase Edge Function  /analyze  (Deno/TS)     |
|                                                            |
|  validate + rate-limit -> cache lookup (by content hash)   |
|         hit -> return stored analysis                      |
|         miss -> LLM provider (Gemini) -> store -> return   |
+------------------------|-----------------------------------+
             |                          |
             v                          v
   +-------------------+     +----------------------------+
   | Postgres          |     | Gemini API (HTTPS)         |
   | policies (cache)  |     | key = server-side secret   |
   +-------------------+     +----------------------------+
```

Boundary summary:
- The extension owns detection, fetching, extraction, and hashing.
- The backend owns validation, abuse protection, caching, and the model call.
- The only shared contract between the two teams is the `/analyze` JSON payload.

## Components and Responsibilities

### 1. Content Script (extension)
Runs in the context of the visited page. Detection only.

- **Detection**: scans `document` anchors for policy links (Req 1). Matches link text or
  href against a case-insensitive keyword set: "privacy policy", "privacy notice",
  "terms of service", "terms and conditions", "terms of use", "terms & conditions".
  Resolves each match to an absolute URL and deduplicates by resolved URL.
- Returns the detected `{ url, text }` list to the service worker; does not fetch,
  extract, or call the backend.
- Rationale: the content script is uniquely able to see the live DOM to find links, but
  a fetch initiated from the page context can be subject to the visited page's CSP
  (`connect-src`). Fetching is therefore moved to the service worker (below).

### 2. Service Worker (extension background)
The orchestrator, and the owner of fetch + extraction. Holds no long-lived state (MV3
workers are ephemeral).

- Receives the detected policy URL from the content script.
- **Fetch**: performs `fetch(policyUrl)`. Because the service worker is not a web page,
  the visited site's CSP does not apply; the fetch is governed by the extension's
  `host_permissions` instead. This is the reason fetch lives here rather than in the
  content script.
- **Extraction**: parses the fetched HTML and extracts readable text (Req 2). MV3
  service workers have no DOM, so `DOMParser` is unavailable; extraction uses a
  DOM-free HTML-to-text parser (a small library) to strip scripts, styles, nav, header,
  footer, and non-content elements, then normalizes whitespace.
- Computes the **content hash** using SubtleCrypto (SHA-256) over normalized text.
- Enforces the **client-side max-length guard** before sending (see Constraints).
- Calls the backend `/analyze` over HTTPS and relays the response to the popup.
- Maps backend errors and network failures to user-facing error states.

> Design note: extraction runs in the worker (fetch + DOM-free parse), not the content
> script. This keeps the CSP-sensitive fetch off the page context and centralizes
> fetch -> parse -> normalize -> hash -> backend in one component. The only cost is a
> DOM-free HTML parsing dependency in place of the built-in `DOMParser`.

### 3. Popup UI (extension)
The user-facing surface (Req 6).

- Triggered by the toolbar icon click.
- States: idle -> detecting -> (list of policy links) -> analyzing (loading) ->
  result (TLDR) or error (with retry).
- Optionally shows a "from cache" indicator when the backend reports a cache hit.

### 4. Edge Function `/analyze` (backend)
Deno/TypeScript on Supabase. Thin by design.

- Validates the request body (Req 5.3): required fields present, text within size
  bounds, URL well-formed.
- Applies **abuse protection**: per-IP rate limiting and input-size cap (see Security).
- Computes/receives the content hash, performs cache lookup (Req 4).
- On miss, calls the **LLM provider module**, stores the analysis, returns it.
- Returns structured JSON including a `cached` boolean (Req 5.5).

### 5. LLM Provider Module (backend)
Isolates the model call behind a narrow interface so the model or vendor is swappable
(Req 3.5, Non-Goal 6).

```ts
interface LlmProvider {
  summarize(policyText: string): Promise<{ tldr: string; model: string }>;
}
```

- MVP implementation: `GeminiProvider`, calling `generateContent` on a configured model
  (default `gemini-2.5-flash`, read from an environment variable).
- The Gemini API key is read from a server-side secret/env var, never shipped to the
  client (Req 3.4, 5.4).

### 6. Data Layer (backend)
A single Postgres table. No user table, no auth.

## Data Model

```sql
create table policies (
  content_hash text primary key,        -- SHA-256 hex of normalized policy text
  source_url   text not null,           -- metadata only; where it was seen
  tldr         text not null,           -- plain-English summary
  model        text not null,           -- e.g. "gemini-2.5-flash"
  created_at   timestamptz not null default now()
);
```

Notes:
- `content_hash` is the primary key, so identical text from different URLs dedupes to one
  row (Req 4.5), and changed text yields a new row (Req 4.6).
- The table intentionally has no user identifier, IP, or session column (Req 4.4).
- No TTL/expiry in the MVP; expiry is deferred (Non-Goal 7).

## Interface Contract: `/analyze`

Request (POST, `application/json`):
```json
{
  "text": "<normalized policy text>",
  "url": "https://example.com/privacy",
  "contentHash": "<sha-256 hex>"
}
```
- `text` required, non-empty, at most MAX_TEXT_CHARS.
- `url` required, must parse as an http(s) URL.
- `contentHash` optional; if provided the backend verifies it matches a re-hash of
  `text` (defense against a mismatched key), otherwise the backend computes it.

Success response:
```json
{
  "tldr": "Plain-English summary...",
  "model": "gemini-2.5-flash",
  "cached": true,
  "contentHash": "<sha-256 hex>"
}
```

Error response:
```json
{ "error": "human-readable message", "code": "VALIDATION|RATE_LIMIT|UPSTREAM|INTERNAL" }
```
- `VALIDATION` -> 400, `RATE_LIMIT` -> 429, `UPSTREAM` (Gemini failure) -> 502,
  `INTERNAL` -> 500.

## Detection and Extraction Approach

Detection heuristic (content script):
1. Collect all `<a>` elements with an href.
2. For each, test `linkText` and `href` (both lowercased) against the keyword set.
3. Resolve to absolute URL via the `URL` constructor with the page as base.
4. Deduplicate by resolved URL; return list of `{ url, text }` (Req 1.2, 1.3).
5. Empty list -> "no policy detected" (Req 1.4).

Extraction (service worker), given a policy URL from the content script:
1. `fetch(url)` from the service worker (governed by `host_permissions`, not page CSP);
   require an HTML content type.
2. Parse with a DOM-free HTML-to-text parser (no `DOMParser` in MV3 workers); remove
   `script`, `style`, `nav`, `header`, `footer`, `aside`, and hidden elements.
3. Take the main text content, normalize whitespace (collapse runs, trim).
4. Guard rails:
   - Non-HTML content type (e.g. PDF) -> bail with `UNSUPPORTED_FORMAT` (Req 2.3).
   - Extracted length below MIN_TEXT_CHARS -> bail with `EXTRACTION_FAILED` (Req 2.5).
   - Interaction-gated / unextractable -> bail with `EXTRACTION_FAILED` (Req 2.4).
   - Extracted length above MAX_TEXT_CHARS -> truncate to the cap before hashing/sending
     (protects client, backend, and Gemini token cost).

## Error Handling

| Failure                          | Detected by      | User-facing result                         |
|----------------------------------|------------------|--------------------------------------------|
| No policy link on page           | content script   | "No privacy policy or terms found here."   |
| Non-HTML resource (PDF, etc.)    | service worker   | "Can't analyze this format yet."           |
| Extraction too short / gated     | service worker   | "Couldn't read the policy on this page."   |
| Text exceeds max length          | service worker   | Truncated silently; analysis proceeds.     |
| Validation error                 | edge function    | "Invalid request." (should not occur in UI)|
| Rate limited                     | edge function    | "Too many requests, try again shortly."    |
| Gemini error/timeout             | edge function    | "Analysis failed, please retry." (retry)   |
| Network failure to backend       | service worker   | "Couldn't reach Privvy, please retry."     |

All error states in the popup are non-fatal and offer retry where sensible (Req 3.3,
6.4).

## Security and Abuse Protection

- **Transport**: HTTPS/TLS on both hops (extension->backend, backend->Gemini). MV3
  service workers can only call https endpoints.
- **Secret handling**: Gemini API key only as a Supabase secret/env var; never in the
  extension bundle (Req 3.4, 5.4).
- **Payload minimization**: only public policy text + source URL cross the wire; no
  identity, cookies, or IP-derived data attached by the client (Privacy Position).
- **Rate limiting**: per-IP throttle at the edge function to protect Gemini quota from a
  public endpoint. Exceeding the limit returns 429 `RATE_LIMIT`.
- **Input caps**: reject or truncate `text` beyond MAX_TEXT_CHARS; reject malformed
  `url`. Treat all input as untrusted (no eval, no reflection).
- **CORS**: extension callers present a `chrome-extension://` origin; strict origin
  allow-listing is unreliable, so rate limiting is the primary control rather than CORS.
- **Page CSP vs. host_permissions**: the policy-page fetch runs in the service worker, so
  the visited site's CSP (`connect-src`) does not apply. The fetch is instead gated by the
  extension's `host_permissions`, which must be broad enough to reach arbitrary policy
  origins (e.g. `<all_urls>` or a broad pattern). Broad host permissions carry a
  privacy-review/UX cost and should be requested deliberately and documented.

## Constraints and Configuration

Configurable values (documented, not hardcoded across the code):
- `GEMINI_MODEL` (default `gemini-2.5-flash`) — server-side env var (Req 3.5).
- `GEMINI_API_KEY` — server-side secret.
- `MAX_TEXT_CHARS` — upper bound on policy text length (client guard + server cap).
- `MIN_TEXT_CHARS` — lower bound below which extraction is deemed failed (Req 2.5).
- `RATE_LIMIT_*` — window and request count for per-IP throttling.

Hash algorithm: SHA-256 (SubtleCrypto on the client, Web Crypto/Deno std on the server),
hex-encoded, computed over the normalized text so client and server agree.

## Traceability

| Requirement                        | Satisfied by                                             |
|------------------------------------|----------------------------------------------------------|
| R1 Policy detection                | Content Script (detection)                               |
| R2 Text extraction                 | Service Worker (fetch + DOM-free parse) + guard rails    |
| R3 Summarization (TLDR)            | Edge Function + LLM Provider (GeminiProvider)            |
| R4 Caching                         | Edge Function (cache flow) + `policies` table            |
| R5 Backend endpoint contract       | Edge Function `/analyze` + interface contract            |
| R6 Extension UX (manual trigger)   | Popup UI + Service Worker orchestration                  |
| Privacy Position (constraint)      | Payload minimization + data model (no user columns)      |
| Abuse protection                   | Security section (rate limit, input caps, TLS)           |

## Deferred (from requirements Non-Goals)

Auto-trigger with consent-context gating, the 8-item risk checklist, deterministic risk
rating, non-HTML extraction, any per-user storage, self-hosted model, and cache expiry
are all out of scope for this MVP and not designed here. The LLM provider interface and
the content-hash schema are chosen so the checklist and self-hosting can be added later
without reworking the extension or the cache.
