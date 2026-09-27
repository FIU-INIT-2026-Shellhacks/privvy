# Privvy

Know what you agree to. Privvy is a Chrome extension that reads the privacy policies and
terms you're about to accept and warns you about the risky parts — before you click
"agree."

Click the Privvy icon on a page, pick a detected policy or terms link, and Privvy shows:

- **Flags** — the concrete privacy dangers it found (e.g. sells your data, trains AI on
  your content, no way to opt out), checked against a fixed 8-point risk checklist.
- **Summary** — a short, plain-English overview (a few lines, no legalese).

Privvy is privacy-respecting by design: it processes only public legal text and never
collects, stores, or transmits any user identity or personal data. Analyzed policies are
cached (by content, not by person) so repeat lookups are instant.

## How it works

The extension detects policy links, fetches and extracts the page text in the browser,
and sends it to a small backend (a Supabase Edge Function) that asks Gemini to produce
the flags and summary. Results are cached in Postgres, keyed by a hash of the policy
text.

## Repository

- `extension/` — the Chrome MV3 extension (TypeScript)
- `backend/` — the `/analyze` Supabase Edge Function (Deno/TypeScript)
- `shared/` — the `/analyze` contract, error codes, config, risk checklist, and hashing,
  shared by both

## Status

MVP is built and deployed. Manual trigger (click the icon); automatic detection on
signup forms is planned for later. See the tradeoffs and spec docs (kept in Notion) for
design decisions and rationale.
