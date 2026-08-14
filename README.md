# NAD Plugins

This monorepo is the source for the NAD Plugin Devkit and the private first-party
plugin workbench. NAD core ships without plugins; administrators install signed
packages through the NAD Marketplace or by uploading a `.nadmod` file.

## Repository layout

```text
devkit/                  Public SDK, schemas, templates, examples and tooling
plugins/official/        First-party plugins under development
plugins/community/       Reserved; community intake is currently disabled
policies/                Review, publishing and public trust-key policy
```

The public `robrolabs/nad-plugins` export initially contains the Devkit only.
An official plugin is exported only after its independent release gate passes.
Preview source and generated `.nadmod` artifacts are never included merely to
populate the public repository.

## Development

Use Node.js and pnpm versions from `.node-version` and `package.json`.

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm ci:gate
```

Build the architecture-neutral Devkit download with:

```bash
pnpm devkit:build
pnpm devkit:verify
pnpm devkit:clean-room
```

The resulting `dist/NAD-Plugin-Devkit-<version>.zip` is deterministic and
contains local SDK, testkit and CLI tarballs. It contains no official plugins,
keys, compiled tests, source maps or package artifacts.

The contract specifications and authoring guidance live under
[`devkit/docs/`](devkit/docs/). Publication and review rules live under
[`policies/`](policies/).

## Licence and security

Source is licensed under `AGPL-3.0-only`. Report vulnerabilities using
[`SECURITY.md`](SECURITY.md); do not open a public issue for a suspected secret
or package-verification vulnerability.
