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
|  (results/errors) <-> (orchestrator,   <->  (detection     |
|                        fetch, extract,      only)          |
|                        hashing)                            |
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
- The content script owns detection only (it needs the live DOM to find links).
- The service worker owns URL validation, fetch, extraction, and hashing.
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

- Receives only the policy URL the user explicitly selected from the detected-link
  list (see popup states). It never fetches a link automatically just because it was
  detected — the content script's list is page-controlled and therefore untrusted.
- **URL validation (SSRF guard)**: before fetching, validates the selected URL and
  rejects it unless it is `https`. Resolves the host and rejects loopback
  (`127.0.0.0/8`, `::1`, `localhost`), link-local (`169.254.0.0/16`, `fe80::/10`),
  and private-network targets (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`,
  unique-local `fc00::/7`). Applies the same validation to every redirect target
  before following it (fetch uses manual redirect handling so each hop is checked).
- **Fetch**: performs `fetch(validatedUrl)`. Because the service worker is not a web
  page, the visited site's CSP does not apply; the fetch is governed by the extension's
  `host_permissions` instead. This is the reason fetch lives here rather than in the
  content script — and the reason the URL/redirect validation above is mandatory, since
  the worker is authorized to reach anywhere `host_permissions` allows.
- **URL sanitization**: before hashing/sending, strips the query string and fragment
  from the URL, keeping only origin + path as `source_url` metadata (see Data Model).
  This prevents secrets that may live in query params (session tokens, account IDs)
  from being transmitted or stored.
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
- States: idle -> detecting -> (list of policy links) -> user selects one link ->
  analyzing (loading) -> result (TLDR) or error (with retry).
- Analysis only begins after the user explicitly selects one detected link. The
  extension never auto-fetches a detected link (SSRF guard; see Service Worker).
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

- MVP implementation: `GeminiProvider`, calling `generateContent` on the model named by
  the `GEMINI_MODEL` env var. There is no safe hardcoded default: Google currently
  limits `gemini-2.5-flash` access to projects that previously used 2.5 models, and
  steers new projects to 3.x models. The deploying project MUST set `GEMINI_MODEL` to a
  model it can actually access, and verify that model against the target project before
  relying on it (see Tasks 4 and 15). `gemini-2.5-flash` is a documented example, not a
  guaranteed-available default.
- The Gemini API key is read from a server-side secret/env var, never shipped to the
  client (Req 3.4, 5.4).

### 6. Data Layer (backend)
A single Postgres table. No user table, no auth.

## Data Model

```sql
create table policies (
  content_hash text primary key,        -- SHA-256 hex of normalized policy text
  source_url   text not null,           -- sanitized: origin + path only, no query/fragment
  tldr         text not null,           -- plain-English summary
  model        text not null,           -- e.g. "gemini-2.5-flash"
  created_at   timestamptz not null default now()
);
```

Notes:
- `content_hash` is the primary key, so identical text from different URLs dedupes to one
  row (Req 4.5), and changed text yields a new row (Req 4.6).
- The table intentionally has no user identifier, IP, or session column (Req 4.4).
- `source_url` is stored sanitized: origin + path only, with the query string and
  fragment stripped before it ever leaves the extension. This prevents secrets that can
  live in query params (session tokens, account IDs) from being transmitted or stored.
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
- `url` required, must be an `https` URL, already sanitized by the client to origin +
  path (no query string or fragment). The backend rejects a URL containing a query or
  fragment as a VALIDATION error (defense in depth against secret leakage).
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

Extraction (service worker), given the user-selected policy URL:
1. Validate the URL (SSRF guard): require `https`; reject loopback, link-local, and
   private-network hosts (see Service Worker). Strip query string and fragment.
2. `fetch(url)` from the service worker with manual redirect handling (governed by
   `host_permissions`, not page CSP); re-validate every redirect target with the same
   rules before following it. Require an HTML content type.
3. Parse with a DOM-free HTML-to-text parser (no `DOMParser` in MV3 workers); remove
   `script`, `style`, `nav`, `header`, `footer`, `aside`, and hidden elements.
4. Take the main text content, normalize whitespace (collapse runs, trim).
5. Guard rails:
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

- **Transport**: TLS on the backend and Gemini hops (extension->backend, backend->Gemini)
  is required. For the policy-page fetch, an MV3 service worker *can* fetch plain HTTP
  when the extension declares matching HTTP host permissions; Privvy deliberately
  restricts policy-page fetches to `https` as a security choice (see SSRF guard), rather
  than because the platform forbids HTTP.
- **SSRF guard (policy fetch)**: the worker fetches only a user-selected `https` URL, and
  rejects loopback, link-local, and private-network hosts on the initial URL and on every
  redirect hop (manual redirect handling). This prevents a page-planted link from
  steering the authorized worker at internal or private endpoints.
- **URL sanitization**: the client strips query string and fragment before sending, and
  the backend rejects any `url` still containing them. Keeps secrets that can live in
  query params out of transit and storage.
- **Secret handling**: Gemini API key only as a Supabase secret/env var; never in the
  extension bundle (Req 3.4, 5.4).
- **Payload minimization**: only public policy text + sanitized source URL (origin +
  path) cross the wire; no identity, cookies, or IP-derived data attached by the client.
- **Rate limiting**: per-IP throttle at the edge function to protect Gemini quota from a
  public endpoint. Exceeding the limit returns 429 `RATE_LIMIT`. The limiter processes
  the caller IP at the edge and stores only a *hashed* IP as a counter key with a TTL
  equal to the rate-limit window (`RATE_LIMIT_WINDOW`); it never stores raw IPs and
  retains nothing past the window. This edge-side, transient IP handling is the one place
  IP is touched, and it is separate from the product's no-user-data guarantee, which
  covers the client payload, the policy cache, and the Gemini request (see Privacy
  Position scoping in requirements).
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
- `GEMINI_MODEL` — server-side env var naming the model (Req 3.5). No hardcoded default;
  the deploying project must set it to a model it can access and verify it (see LLM
  Provider Module). `gemini-2.5-flash` is an example, not a guaranteed default.
- `GEMINI_API_KEY` — server-side secret.
- `MAX_TEXT_CHARS` — upper bound on policy text length (client guard + server cap).
- `MIN_TEXT_CHARS` — lower bound below which extraction is deemed failed (Req 2.5).
- `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX` — window duration and max requests per window for
  per-IP throttling. The window also serves as the TTL for the hashed-IP counter.

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
