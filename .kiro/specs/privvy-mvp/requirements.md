# Privvy MVP — Requirements

## Overview

Privvy is a Chrome extension that helps people understand the privacy policies and
terms & conditions they agree to when signing up for web apps. It detects policy
documents, extracts their text, and produces a plain-English TLDR summary through a
backend that calls the Gemini API. Analyzed policies are cached so repeat lookups are
instant and cheap.

The guiding principle is that Privvy is itself a privacy-respecting tool: it never
collects, stores, or transmits any user identity or personal data. The only content it
processes is public legal text (a published privacy policy or terms document).

## Terminology

- **Policy document**: A privacy policy or terms & conditions page — the published legal
  text Privvy analyzes.
- **Consent context**: On-page signals that the user is at a signup/agreement moment
  (e.g. a signup form, an "I agree" checkbox near policy links). Used in the later
  auto-trigger phase to decide when to act.
- **Policy link**: An anchor/link on a page pointing to a policy document.
- **TLDR**: The plain-English summary Privvy produces for a policy document.
- **Content hash**: A hash of the extracted, normalized policy text, used as the cache
  key. Identifies a policy by what it says, not where it lives.
- **Analysis**: The stored result of processing one policy document (currently: the
  TLDR; later: the risk checklist).
- **Backend**: The Supabase Edge Function (Deno/TypeScript) the extension calls. Holds
  the Gemini API key as a server-side secret.
- **Risk checklist**: A fixed set of privacy-risk questions evaluated against a policy.
  Deferred to a later phase (see Non-Goals).

## MVP Scope

The MVP pipeline is: **detect → extract → summarize → cache**, triggered manually
(user clicks the Privvy icon). Fully automatic triggering and the risk checklist are
defined but explicitly deferred to later phases.

---

## Requirements

### Requirement 1: Policy Detection

**User story:** As a user on a web page, I want Privvy to identify the privacy policy
and terms links on that page, so that I can analyze them without hunting for them
myself.

#### Acceptance Criteria

1. WHEN the user invokes Privvy on a page THEN Privvy SHALL scan the page for links
   whose visible text or href indicates a policy document (e.g. "privacy policy",
   "privacy notice", "terms of service", "terms and conditions", "terms of use").
2. WHEN a matching link is found THEN Privvy SHALL record its resolved absolute URL and
   its visible link text.
3. WHEN multiple policy links are found THEN Privvy SHALL present all distinct ones
   (deduplicated by resolved URL).
4. WHEN no policy link is found on the page THEN Privvy SHALL report that no policy was
   detected rather than failing silently.
5. WHEN matching link text THEN Privvy SHALL match case-insensitively and tolerate extra
   surrounding words (e.g. "Read our Privacy Policy here").

> Note: In the MVP, detection runs on user invocation. Consent-context gating for the
> fully automatic trigger is a later phase (see Non-Goals).

### Requirement 2: Text Extraction

**User story:** As a user, I want Privvy to pull the readable text out of a policy page,
so that it can be summarized accurately.

#### Acceptance Criteria

1. WHEN a policy link points to a normal HTML page THEN Privvy SHALL fetch and extract
   its main readable text content, excluding navigation, headers, footers, and scripts.
2. WHEN the extracted text is obtained THEN Privvy SHALL normalize it (collapse
   whitespace, strip markup) before hashing and summarizing.
3. IF the policy link points to a non-HTML resource (e.g. a PDF) THEN Privvy SHALL bail
   gracefully with a clear "cannot analyze this format yet" message and SHALL NOT crash
   or hang.
4. IF the page requires interaction to reveal the policy (modal, "load more", cookie
   wall) and the text cannot be extracted THEN Privvy SHALL bail gracefully with a clear
   message.
5. IF the extracted text is below a minimum length threshold (implying extraction
   failed) THEN Privvy SHALL treat it as an extraction failure and report it, rather
   than summarizing garbage.

### Requirement 3: Summarization (TLDR)

**User story:** As a user, I want a short plain-English summary of what a policy says,
so that I understand it without reading the whole document.

#### Acceptance Criteria

1. WHEN normalized policy text is available AND not cached THEN the backend SHALL call
   the Gemini API to produce a plain-English TLDR of the policy.
2. WHEN the TLDR is produced THEN it SHALL be concise (a short paragraph or a few
   bullet points) and written for a non-lawyer.
3. WHEN the Gemini API returns an error or times out THEN the backend SHALL return a
   clear error status to the extension, and the extension SHALL show a retryable error
   state rather than a broken UI.
4. WHEN summarizing THEN the backend SHALL send only the policy text — no user identity,
   IP-derived data, or browsing history.
5. The Gemini model name SHALL be a server-side configuration value, so it can be
   changed without code edits to the extension.

### Requirement 4: Caching

**User story:** As the operator, I want analyzed policies cached, so that repeat
analyses are instant and we minimize API calls, without storing anything about users.

#### Acceptance Criteria

1. WHEN policy text is normalized THEN the backend SHALL compute a content hash of that
   text to use as the cache key.
2. WHEN an analysis request arrives AND the content hash exists in the cache THEN the
   backend SHALL return the stored analysis without calling Gemini (a cache hit).
3. WHEN an analysis request arrives AND the content hash is not cached THEN the backend
   SHALL call Gemini, store the result keyed by content hash, and return it (a cache
   miss).
4. WHEN storing an analysis THEN the record SHALL contain only: content hash, source
   URL (metadata), TLDR, model identifier, and a timestamp. It SHALL NOT contain any
   user identifier, IP address, or session data.
5. WHEN the same policy is served from a different URL but has identical text THEN it
   SHALL resolve to the same cache entry (because the key is the content hash).
6. WHEN a policy's text changes THEN its content hash changes, producing a cache miss
   and a fresh analysis (old entry is retained as a separate record).

### Requirement 5: Backend Endpoint Contract

**User story:** As the extension, I want a single well-defined endpoint to analyze a
policy, so that the client stays simple and the API key stays server-side.

#### Acceptance Criteria

1. The backend SHALL expose an `/analyze` endpoint that accepts the extracted policy
   text and its source URL.
2. WHEN `/analyze` receives a request THEN it SHALL perform the cache-check-then-Gemini
   flow (Requirement 4) and return the analysis as structured JSON.
3. WHEN `/analyze` receives a request missing required fields THEN it SHALL return a
   validation error with a clear message and SHALL NOT call Gemini.
4. The Gemini API key SHALL be stored only as a server-side secret and SHALL NEVER be
   present in the extension bundle or client-side code.
5. The response SHALL indicate whether the result came from cache or was freshly
   generated (useful for the demo and debugging).

### Requirement 6: Extension UX (Manual Trigger)

**User story:** As a user, I want to click the Privvy icon on a page and see the
policy summary, so that I can quickly understand what I'm agreeing to.

#### Acceptance Criteria

1. WHEN the user clicks the Privvy toolbar icon THEN the extension SHALL run detection
   on the current page and show the detected policy link(s).
2. WHEN a policy is being analyzed THEN the extension SHALL show a loading state.
3. WHEN an analysis returns THEN the extension SHALL display the TLDR in a readable
   popup/panel.
4. WHEN detection, extraction, or analysis fails THEN the extension SHALL show a clear,
   human-readable message describing what went wrong.
5. WHEN a result was served from cache THEN the extension MAY indicate it was a cached
   result (optional, for transparency).

---

## Non-Goals (Explicitly Deferred)

These are intentionally out of scope for the MVP. They are real planned work, recorded
here so scope stays clear.

1. **Fully automatic triggering.** The MVP is manual (icon click). Auto-detection gated
   on consent context (signup forms, "I agree" checkboxes) is the next phase, built on
   the same detect→extract→summarize→cache pipeline.
2. **Risk checklist.** The fixed checklist below is planned but not built in the MVP.
   When added, the LLM will only extract facts (yes/no/unknown per item), and a
   deterministic rule in code will map facts to any rating — the model never produces
   the rating directly.
   1. Sells or shares data with third parties
   2. Uses your content to train AI
   3. Indefinite or unclear data retention
   4. Difficult to delete your data or account
   5. Forced arbitration or class-action waiver
   6. Broad license to your content
   7. Tracks you across other sites
   8. No opt-out mechanism (no way to decline data collection/sharing)
3. **Overall risk rating** (e.g. green/yellow/red). Deferred with the checklist; must be
   computed deterministically from extracted facts, not emitted by the LLM.
4. **Non-HTML extraction** (PDF, image-based, JS-gated modals). MVP handles normal HTML
   and bails gracefully on the rest.
5. **User accounts, auth, history, or any per-user storage.** Never in scope — Privvy is
   user-agnostic by design.
6. **Self-hosted / on-device model.** MVP uses the hosted Gemini API. The backend will
   isolate the model call behind a provider interface so a self-hosted open-weight model
   can be swapped in later without changing the extension or cache.
7. **Cache expiry / invalidation.** The MVP retains all analyses indefinitely (a changed
   policy simply creates a new record). Expiring or invalidating stale entries — e.g. a
   TTL, or re-analyzing when a cached entry exceeds some age — is planned future work,
   not built in the MVP.

## Privacy Position (Design Constraint)

- Privvy sends only public legal text (the policy document) to the backend and on to
  Gemini. No user identity, IP-derived data, or browsing history is transmitted.
- No user data is stored. The cache holds analyses of documents, keyed by document
  content, with no link to any person.
- These are hard constraints, not features: every requirement above must hold to them.
