# NAD Plugins agent guide

This repository owns the public Plugin Devkit contracts and the private
first-party plugin workbench. It does not own NAD core, the Marketplace website,
deployment state or Marketplace accounts.

## Boundaries

- `devkit/schemas/` is the contract source of truth; generated SDK declarations
  must be refreshed with `pnpm contracts:generate`.
- New integrations use schema v2 App/Add-on packages. Schema v1 remains a
  compatibility surface.
- Official plugin candidates stay in `plugins/official/` and are excluded from
  the default public export until individually allowlisted.
- Provider-specific proof fixtures belong under their official plugin, never in
  the public Devkit examples.
- Community publishing is disabled. Do not add executable community source
  without an explicit policy change and review workflow.
- Never commit private signing keys, package artifacts, environment files,
  credentials or operator evidence.
- Plugin server code uses only the capability-gated NAD Host API contract. It
  must not import network, filesystem, npm, JSR or Deno runtime dependencies.

## Required reading

- `devkit/docs/APP_SPEC_V2.md`
- `devkit/docs/MODULE_SPEC.md`
- `devkit/docs/COMPATIBILITY.md`
- `devkit/docs/TESTING.md`
- `policies/REVIEW_POLICY.md`
- `policies/PUBLISHING.md`

## Required checks

Run `pnpm ci:gate` before a release. For a public snapshot, also run
`pnpm export:public -- --out <empty-directory>` and then
`pnpm export:verify -- <directory>`.
