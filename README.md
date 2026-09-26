# privvy
Privvy App - Inform Users of Web App Privacy Practices

## Executive Summary

Privvy is a Chrome extension that helps people understand the privacy policies and
terms & conditions they agree to when signing up for web apps. Click the Privvy icon on
a page, pick a detected policy link, and get a short plain-English TLDR of what it says.

Privvy is itself privacy-respecting by design. It processes only public legal text and
never collects, stores, or transmits user identity or personal data.

## MVP Scope

The MVP pipeline is **detect → extract → summarize → cache**, triggered manually by the
user.

| # | Requirement | Summary |
|---|-------------|---------|
| R1 | Policy detection | Find privacy/terms links on the page (case-insensitive, deduplicated). User must explicitly select one before anything is fetched. |
| R2 | Text extraction | Fetch the selected `https` page, extract and normalize readable text. Bail gracefully on PDFs, gated content, or too-short text. SSRF-guarded; query strings and fragments stripped. |
| R3 | Summarization | Backend calls Gemini to produce a concise, non-lawyer TLDR. Model is server-side config with no hardcoded default. |
| R4 | Caching | Results keyed by SHA-256 of normalized text. Identical text dedupes across URLs; changed text yields a fresh analysis. No user data stored. |
| R5 | `/analyze` endpoint | Single JSON endpoint; validates input, runs cache-then-Gemini flow, reports `cached` flag. API key stays server-side. |
| R6 | Extension UX | Popup with detecting, link list, loading, result, and retryable error states. |

## Architecture

```
Chrome Extension (MV3, TypeScript)
  Content Script  -> detection only (reads the live DOM for policy links)
  Service Worker  -> URL validation, fetch, DOM-free extraction, hashing, backend call
  Popup UI        -> link selection, loading, TLDR, errors
        |
        | HTTPS: normalized text + sanitized URL only
        v
Supabase Edge Function /analyze (Deno, TypeScript)
  validate + rate-limit -> cache lookup by content hash
    hit  -> return stored analysis
    miss -> LLM provider (Gemini) -> store -> return
        |                          |
   Postgres `policies` table   Gemini API (server-side key)
```

Key design decisions:

- Fetch and extraction run in the service worker, not the content script, so the
  visited site's CSP doesn't apply. The trade-off is broad `host_permissions` and a
  DOM-free HTML parser.
- The model call sits behind a narrow `LlmProvider` interface, so Gemini can later be
  swapped for another vendor or a self-hosted model.
- The only contract between the extension and backend is the `/analyze` JSON payload,
  which lets the two tracks be built in parallel.

### `/analyze` contract

```jsonc
// Request
{ "text": "<normalized policy text>", "url": "https://example.com/privacy", "contentHash": "<sha-256 hex, optional>" }

// Success
{ "tldr": "...", "model": "<GEMINI_MODEL>", "cached": true, "contentHash": "<sha-256 hex>" }

// Error: VALIDATION -> 400, RATE_LIMIT -> 429, UPSTREAM -> 502, INTERNAL -> 500
{ "error": "human-readable message", "code": "VALIDATION" }
```

### Data model

A single cache table with no user, IP, or session columns:

```sql
create table policies (
  content_hash text primary key,   -- SHA-256 hex of normalized text
  source_url   text not null,      -- origin + path only
  tldr         text not null,
  model        text not null,
  created_at   timestamptz not null default now()
);
```

## Security and Privacy

- **Minimal payload:** only public policy text and a sanitized URL (origin + path) leave
  the browser. No cookies, identity, or browsing history.
- **SSRF guard:** policy fetches must be `https`. Loopback, link-local, and private-network
  hosts are rejected on the initial URL and on every redirect hop.
- **URL sanitization:** the client strips query strings and fragments, and the backend
  rejects any URL that still has them.
- **Secrets:** the Gemini API key exists only as a Supabase secret, never in the
  extension bundle.
- **Abuse protection:** per-IP rate limiting at the edge. It stores only a hashed IP
  counter with a TTL equal to the rate-limit window. This is the one place IP is touched,
  and it is scoped separately from the product's no-user-data guarantee.
- **Input caps:** text length is bounded by `MIN_TEXT_CHARS` / `MAX_TEXT_CHARS` on both
  client and server.

## Configuration

| Variable | Where | Purpose |
|----------|-------|---------|
| `GEMINI_API_KEY` | Server secret | Gemini API access |
| `GEMINI_MODEL` | Server env | Model name. Required, no default. Verify your project can access it. |
| `MAX_TEXT_CHARS` / `MIN_TEXT_CHARS` | Client + server | Text length bounds |
| `RATE_LIMIT_WINDOW` / `RATE_LIMIT_MAX` | Server env | Per-IP throttle window and limit |

## Delivery Plan

1. **Foundation:** shared `/analyze` types, error codes, repo scaffolding, `.env.example`.
2. **Track A, Backend:** `policies` migration, hashing util, Gemini provider, cache flow,
   `/analyze` validation, rate limiting.
3. **Track B, Extension:** MV3 manifest, detection, SSRF-guarded fetch and extraction,
   client hashing (parity with server), worker orchestration, popup UI.
4. **Integration:** end-to-end run on a real page, plus a manual real-service
   verification pass (model access, PDF bail-out, SSRF rejection, rate limit).

## Out of Scope (Planned Later)

- Automatic triggering based on consent context (signup forms, "I agree" checkboxes)
- An 8-item risk checklist with a deterministic, code-computed risk rating (the LLM
  extracts facts only; it never assigns the rating)
- Non-HTML extraction (PDFs, image-based, JS-gated content)
- Self-hosted or on-device model
- Cache expiry and invalidation
- User accounts, auth, or per-user history (never in scope)
