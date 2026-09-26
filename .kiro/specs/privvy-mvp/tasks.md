# Privvy MVP — Tasks

Implementation plan for the MVP pipeline (detect -> extract -> summarize -> cache),
manual trigger. Tasks are ordered so shared contracts land first, then work splits into
parallel tracks teammates can own independently. Each task references the requirements
it satisfies.

## How to use this list

- **Track A (Backend)** and **Track B (Extension)** can proceed in parallel once the
  Foundation tasks are done.
- The single hard dependency between tracks is the `/analyze` contract, pinned in
  Task 1. Build to that contract and integration stays cheap.
- Each teammate should pick a track (or a task within one), not cherry-pick across, to
  avoid collisions.
- Mark a task done only when its tests pass. Every behavioral task ships with tests in
  the same change; scaffolding/config tasks note why tests are or aren't included.

---

## Foundation (do first, unblocks both tracks)

- [ ] 1. Pin shared contracts and repo scaffolding
  - Create the `/analyze` request/response TypeScript types in a shared location
    (request: `text`, `url`, optional `contentHash`; response: `tldr`, `model`,
    `cached`, `contentHash`; error: `error`, `code`).
  - Define the shared error `code` enum (`VALIDATION`, `RATE_LIMIT`, `UPSTREAM`,
    `INTERNAL`) and the config value names (`GEMINI_MODEL`, `MAX_TEXT_CHARS`,
    `MIN_TEXT_CHARS`, `RATE_LIMIT_*`).
  - Set up the repo: TypeScript config, formatter/linter, folder layout for extension
    vs. backend, and a `.gitignore` covering secrets and local env files.
  - Add a `.env.example` documenting required variables with placeholder values
    (`GEMINI_API_KEY`, `GEMINI_MODEL`, etc.). No real secrets committed.
  - _Requirements: 5.1, 5.2; enables all others._
  - _Note: contracts/config scaffolding — no behavioral tests; correctness is verified
    by both tracks compiling against the shared types._

---

## Track A — Backend (Supabase Edge Function)

- [ ] 2. Provision the `policies` table
  - Create the migration for the `policies` table exactly per the design (content_hash
    PK, source_url, tldr, model, created_at). No user/identity columns.
  - _Requirements: 4.4, 4.5, 4.6._
  - _Note: schema task; verified by a migration apply + a round-trip insert/select test._

- [ ] 3. Content-hash + text normalization utility (server)
  - Implement normalization (collapse whitespace, trim) and SHA-256 hex hashing that
    matches the client's algorithm byte-for-byte, so hashes agree across both sides.
  - _Requirements: 4.1._
  - _Tests: known input -> known hash; normalization idempotence; parity with the
    client util's expected vectors._

- [ ] 4. LLM provider interface + GeminiProvider
  - Define `LlmProvider.summarize(policyText)` and implement `GeminiProvider` calling
    `generateContent` on `GEMINI_MODEL` (default `gemini-2.5-flash`), key from
    server-side env/secret.
  - Return `{ tldr, model }`. Handle upstream errors/timeouts as a typed failure.
  - _Requirements: 3.1, 3.2, 3.4, 3.5._
  - _Tests: mocked Gemini HTTP — success path returns TLDR; error/timeout maps to
    UPSTREAM; asserts the key is read from env and never logged. No live network in the
    automated suite._

- [ ] 5. Cache lookup + store flow
  - Given a content hash: return the stored analysis on hit (no Gemini call); on miss
    call the provider, store the row, return it with `cached` set correctly.
  - _Requirements: 4.2, 4.3, 5.5._
  - _Tests: hit returns cached without invoking the provider (assert provider not
    called); miss invokes provider once and persists; `cached` flag correct both ways._

- [ ] 6. `/analyze` endpoint: validation + wiring
  - Parse/validate the body (required fields, URL well-formed, text non-empty and within
    MAX_TEXT_CHARS). If `contentHash` supplied, verify it re-hashes to the same value.
  - Wire validation -> cache/store flow -> typed JSON response and error codes/statuses.
  - _Requirements: 5.1, 5.2, 5.3, 3.3._
  - _Tests: valid request happy path; missing/blank field -> 400 VALIDATION (no provider
    call); oversized text -> rejected/capped per design; mismatched contentHash ->
    VALIDATION; Gemini failure surfaces as 502 UPSTREAM._

- [ ] 7. Abuse protection (rate limiting + input caps)
  - Implement per-IP rate limiting at the edge (counter store or Deno KV sliding window),
    returning 429 RATE_LIMIT when exceeded. Enforce MAX_TEXT_CHARS server-side.
  - _Requirements: Security/abuse protection (design); 5.3._
  - _Tests: requests under the limit pass; over the limit -> 429; window resets; oversize
    input rejected. Time/window dependency injected so tests are deterministic and
    offline._

---

## Track B — Extension (Chrome MV3, TypeScript)

- [ ] 8. Extension scaffolding + MV3 manifest
  - Set up the MV3 manifest. The policy-page fetch runs in the service worker, so it
    needs `host_permissions` broad enough to reach arbitrary policy origins (e.g.
    `<all_urls>` or a broad pattern), plus `activeTab`/`scripting` for the content
    script. Keep permissions least-privilege but sufficient for cross-origin fetch;
    document why the broad host permission is required. Wire the popup, service worker,
    and content-script entry points and the TS build.
  - _Requirements: 6.1 (enables); least-privilege permissions; page-CSP/host_permissions
    (design)._
  - _Note: scaffolding — verified by loading the unpacked extension and the popup opening;
    no behavioral unit tests for manifest itself._

- [ ] 9. Policy detection (content script)
  - Scan anchors, match the keyword set case-insensitively against link text and href,
    resolve to absolute URLs, deduplicate, return `{ url, text }[]` to the service
    worker. Empty -> no-policy signal. Detection only: the content script does not fetch
    or extract (fetch is CSP-sensitive and lives in the worker).
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5._
  - _Tests (on fixture DOMs): finds policy + terms links; ignores unrelated links;
    case/extra-words tolerant; dedupes same resolved URL; empty page -> no-policy._

- [ ] 10. Text extraction + guard rails (service worker)
  - In the service worker: fetch the policy URL (governed by `host_permissions`, immune
    to page CSP), require HTML content type, parse with a DOM-free HTML-to-text parser
    (no `DOMParser` in MV3 workers), strip non-content elements, normalize text. Apply
    guards: non-HTML -> UNSUPPORTED_FORMAT; below MIN_TEXT_CHARS -> EXTRACTION_FAILED;
    above MAX_TEXT_CHARS -> truncate.
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5; page-CSP/host_permissions (design)._
  - _Tests (mocked fetch + fixture HTML): clean extraction on a normal page; PDF
    content-type bails; too-short bails; oversized truncates; whitespace normalized. No
    live network._
  - _Decision: extraction moved from the content script to the service worker so the
    cross-origin fetch is governed by host_permissions rather than the visited page's
    CSP; requires a DOM-free HTML parser dependency._

- [ ] 11. Client hashing util (parity with server)
  - SHA-256 hex over normalized text via SubtleCrypto, matching Task 3's output exactly.
  - _Requirements: 4.1._
  - _Tests: shared vectors produce identical hashes to the server util._

- [ ] 12. Service worker orchestration + backend call
  - Receive the detected policy URL from the content script, run the fetch+extraction
    from Task 10, enforce the client max-length guard, compute the hash, POST to
    `/analyze` over HTTPS, relay the response. Map network and typed backend errors to
    user-facing states.
  - _Requirements: 6.2, 6.4, 3.3; payload minimization (only text + url)._
  - _Tests (mocked backend): success relays TLDR; 429/502/network map to correct error
    states; asserts no identity/cookies added to the payload._

- [ ] 13. Popup UI (states + rendering)
  - Implement the state machine: idle -> detecting -> link list -> analyzing (loading) ->
    result (TLDR) or error (with retry). Optional "from cache" indicator.
  - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5._
  - _Tests: state transitions render the right view; error states show retry; TLDR
    renders; loading shown during analysis._

---

## Integration (after both tracks land)

- [ ] 14. End-to-end wiring on a real page
  - Load the unpacked extension, click Privvy on a real signup page with a normal-HTML
    policy, confirm detect -> extract -> summarize -> render works end to end against the
    deployed edge function. Confirm a second run on the same policy reports `cached`.
  - _Requirements: 1-6 integrated._
  - _Note: manual E2E against the live backend + Gemini using a real key. This is the
    required real-service verification step; keep it out of the automated suite._

- [ ] 15. Manual real-service verification pass
  - Deliberately verify the mocked contracts against reality: one real Gemini call shape
    matches `GeminiProvider`; one real policy page extracts cleanly; a PDF link bails
    gracefully; rate limit triggers under rapid repeated calls.
  - _Requirements: 2.3, 3.1, 4.2, abuse protection — validated against real services._
  - _Note: manual, credentialed, outside CI._

---

## Notes on parallelization

- Foundation (Task 1) is the only strict prerequisite for everything.
- Within Track A: Task 2 and 3 are independent; 4 depends on nothing but its own mock;
  5 depends on 2-4; 6 depends on 3-5; 7 can be built alongside 6 and merged into the
  endpoint.
- Within Track B: 8 first; then 9 (content-script detection) and 11 (hash util) are
  independent and parallelizable. 10 (worker fetch+extraction) and 12 (worker
  orchestration) both live in the service worker and are closely coupled — same owner,
  10 then 12. 13 depends on 12 for wiring but its UI states can be built against a stub.
- Tasks 3 and 11 must agree on the exact hash/normalization; treat their shared test
  vectors as the source of truth.
