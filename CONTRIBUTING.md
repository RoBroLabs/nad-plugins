# Contributing

This repository accepts contributions to the Plugin Development Kit and to
plugins. NAD core and the Marketplace are not developed here.

## Before you start

Read [`devkit/docs/APP_SPEC_V2.md`](devkit/docs/APP_SPEC_V2.md) and
[`devkit/docs/TESTING.md`](devkit/docs/TESTING.md). Plugin server code may use
only the capability-gated Host API — it must not import network, filesystem,
npm, JSR or Deno runtime dependencies, because the sandbox denies them at
execution time rather than failing gracefully.

## Working on the Devkit

Bug reports and improvements to contracts, documentation, scaffolds and test
tooling are welcome. `devkit/schemas/` is the contract source of truth; if you
change it, regenerate the SDK declarations with `pnpm contracts:generate` and
commit the result.

Keep changes focused, license contributed source `AGPL-3.0-only`, and run the
full gate before opening a pull request:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm ci:gate
```

## Writing your own plugin

You do not need to contribute here to publish a plugin. Scaffold one with the
Devkit, build it, sign it with your own key and distribute the `.nadmod` — NAD
installs any package whose signature and declared capabilities verify.
[`docs/RELEASING.md`](docs/RELEASING.md) covers versioning, tagging and signing.
[`policies/PUBLISHING.md`](policies/PUBLISHING.md) describes how a plugin reaches
the Marketplace catalogue, and [`policies/REVIEW_POLICY.md`](policies/REVIEW_POLICY.md)
what a review covers.

## Never submit

Package binaries, private keys, credentials, environment files, generated build
directories, or source copied from an unreviewed third party. A contributor
supplied binary is never signed or promoted; releases are rebuilt from reviewed
source.
