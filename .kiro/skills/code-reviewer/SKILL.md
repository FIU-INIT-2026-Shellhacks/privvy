---
name: "code-reviewer"
description: "reviews the recent git fetch/pull commits on the repo and performs secure software development"
---

# Skill: Secure Code Review

## Overview

Reviews the recent git fetch/pull commits against the codebase and ensures secure design principles for secure software development.

## Trigger & Usage Rules

Specify when this skill should be active and any mandatory constraints:

- **Triggers:** Activate when the user asks to review recent git fetch/pull commits, audit code for security issues, or perform a code review.
- **Constraints:** Do not use for unrelated tasks such as scaffolding new projects or non-review code generation.

## Reference Standard

The project's secure design standard is included below and must be treated as the
authoritative reference when reviewing code:

<!-- #[[file:Introduction.md]] -->

#[[file:secure-design-principles.md]]

## Instructions & Workflow

Review the code strictly against the secure design principles in the reference
standard above. Work through the steps in order.

### Step 1: Gather the change set and its context

- Identify what to review. Default to the most recent pulled/fetched commits:
  run `git log --oneline origin/HEAD..HEAD` (or `git log -n <N>`) and inspect the
  diffs with `git show <sha>` / `git diff`. If the user names a range or files,
  use those instead.
- For each changed file, read enough surrounding code to understand the change,
  not just the diff hunk. A vulnerability often lives in the code the diff touches
  rather than the added line itself.
- Establish the **trust boundary** for each change: what runs in an environment
  you control (server, backend) versus what an attacker can control (browser,
  mobile app, CLI args, network input, other processes). Every later check is
  judged relative to this boundary.

### Step 2: Evaluate against the secure design principles

For each change, check it against the principles in the reference standard. Flag
any violation. At minimum, check:

1. **Least privilege** — Does code request only the privileges/data it needs? Are
   privileges dropped as early as possible? Are file/resource/DB permissions
   minimal (watch for world-writable files, over-broad SQL GRANTs, unused write
   APIs)? (CWE-269, CWE-732, CWE-276)
2. **Complete mediation / non-bypassability** — Is every request from outside the
   trust boundary checked (authorization + input validation)? Reject designs that
   rely on client-side (HTML/JS/WASM/mobile) checks for security; those checks
   must be (re)done on a trusted system. Flag direct untrusted DB access and
   hijackable (non-TLS/SSH) channels.
3. **Economy of mechanism (simplicity)** — Is the security-relevant code as simple
   and small as reasonably possible?
4. **Open design** — Does security depend on secrecy of the mechanism or
   obfuscation (e.g. JS minification) rather than on secrets like keys/passwords?
   Flag any "security through obscurity."
5. **Fail-safe defaults** — Do defaults deny unless explicitly allowed? No empty/
   default passwords; secure default permissions.
6. **Separation of privilege** — Does sensitive access depend on more than one
   condition (e.g. 2FA support) where appropriate?
7. **Least common mechanism** — Is sharing of files, directories, or runtime with
   untrusted parties minimized?
8. **Psychological acceptability** — Are security mechanisms usable enough that
   users will not work around them?

Also check the additional principles from the standard:

- **Race conditions / TOCTOU** — Flag check-then-act gaps. Prefer atomic APIs
  (`open()` over `access()`+`open()`, `O_EXCL`/`x` mode, create with minimal
  privileges then expand). Require secure temp-file creation (`tempfile`,
  `mktemp`). (CWE-362, CWE-377)
- **Harden the system** — Are defect-limiting mechanisms (CSP, ASLR, sandboxing)
  enabled or enableable?
- **Keep secrets secret** — No live secrets in source; passwords stored with an
  iterated salted hash (argon2id/bcrypt/PBKDF2); `https://` not `http://`; secrets
  not passed as command-line args.
- **Trust only trustworthy channels** — Input and results come over authenticated,
  encrypted channels (TLS/SSH).
- **Separate data from control** — Data is not executable as code (e.g. CSP blocks
  inline scripts; no injection paths). (OWASP Top 10 #4: Insecure Design)

Treat these as an aid to thinking, not a checklist to game: note where a principle
genuinely does not apply or where two principles trade off, and explain the call.

### Step 3: Report the findings

Produce a Markdown report:

- **Summary** — one or two sentences on overall risk and what was reviewed.
- **Findings** — one entry per issue, ordered by severity (Critical, High, Medium,
  Low). For each: the file and line reference, the principle(s) violated, why it is
  a risk, and a concrete remediation. Cite the relevant CWE/OWASP id when the
  standard names one.
- **Passed checks / notes** — briefly note principles that were relevant and
  satisfied, and any accepted trade-offs.

If no issues are found, say so explicitly and list the principles you verified.

## Examples

### Example 1: Reviewing recent commits

**User:** Review the latest commits I just pulled for security issues.

**Expected Behavior/Output:** Inspect the recent commit diffs and report findings grouped by severity, with file and line references. Evaluate each changed file against the secure design principles in the reference standard (`Introduction.md` and `secure-design-principles.md`).
