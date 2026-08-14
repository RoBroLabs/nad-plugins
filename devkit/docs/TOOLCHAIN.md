# Supported toolchain

Release gates use:

| Tool | Supported release-gate versions |
|---|---|
| Node.js | `20.20.x`, `22.22.x` |
| pnpm | `9.15.0` |
| Deno runtime | `2.7.7` |
| Linux | amd64, arm64 |

`.node-version`, `.deno-version` and the root `packageManager` field provide the
local pins. The CI workflow tests both Node lines on amd64 and runs the same
container gate on a native Linux arm64 runner or, for release validation, under
QEMU on controlled infrastructure. The Dockerfile downloads the Deno
archive for the active architecture and verifies its published SHA-256 before
use.

Use Corepack where possible:

```bash
corepack enable
corepack prepare pnpm@9.15.0 --activate
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm ci:gate
```

Module server bundles must also pass `deno check` and a no-permissions Deno
smoke invocation. Node built-ins, remote imports and runtime dependency imports
are rejected by the SDK contract gate.

Public SDK packages are deliberately small: `@nad/sdk` and `@nad/testkit` ship
compiled `dist/` output only; `@nad/cli` additionally ships its scaffold
templates. Source, tests and TypeScript build caches remain available in this
repository but are excluded from published tarballs.
