# backend/ — Track A (Supabase Edge Function)

Owned by the backend track. This directory is intentionally a placeholder from the
Foundation setup; the backend team sets up its own Deno/Supabase toolchain here.

## Shared contract

The `/analyze` request/response types, error codes, and config names live in
`../shared/src`. The backend is Deno, so it does not use the npm workspace — import the
shared types by relative path to the source `.ts` files, for example:

```ts
import type { AnalyzeRequest, AnalyzeSuccess } from '../../shared/src/contract.ts';
import { ErrorCode, ERROR_STATUS } from '../../shared/src/errors.ts';
```

This keeps a single source of truth for the contract across both tracks without forcing
Deno and npm to share a package manager.

## Tasks (see .kiro/specs/privvy-mvp/tasks.md)

Track A: 2 (policies table), 3 (hashing util), 4 (Gemini provider), 5 (cache flow),
6 (/analyze validation), 7 (rate limiting).
