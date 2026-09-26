# backend/ — Track A (Supabase Edge Function)

Owned by the backend track. This directory is intentionally a placeholder from the
Foundation setup; the backend team sets up its own Deno/Supabase toolchain here.

## Shared contract

The `/analyze` request/response types, error codes, and config names are the single
source of truth in `../shared`. The backend is Deno, so it does not use the npm
workspace. Import the shared contract from the package's **built output** (`shared/dist`),
not the raw `../shared/src` TypeScript.

Why the built output: the source files use `.js`-extension imports (e.g. `contract.ts`
imports `./errors.js`), which is the correct convention for the TypeScript build but does
not resolve when Deno reads the raw `.ts` source. After building, `dist/` contains real
`.js` files, so those imports resolve and Deno reads plain JavaScript with no issue.

### Build the shared package first

`shared/dist` is gitignored, so it must be built from a fresh clone before the backend
can import it:

```sh
npm --prefix ../shared run build   # emits ../shared/dist/*.js and *.d.ts
```

Wire this into the backend's local run / deploy step so it is not a manual chore.

### Import from dist

```ts
import type { AnalyzeRequest, AnalyzeSuccess } from '../shared/dist/contract.js';
import { ErrorCode, ERROR_STATUS } from '../shared/dist/errors.js';
```

(Adjust the relative depth to match the file doing the import.) This keeps a single
source of truth for the contract across both tracks without forcing Deno and npm to share
a package manager.

## Tasks (see .kiro/specs/privvy-mvp/tasks.md)

Track A: 2 (policies table), 3 (hashing util), 4 (Gemini provider), 5 (cache flow),
6 (/analyze validation), 7 (rate limiting).
