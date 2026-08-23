# NAD Plugins

The Plugin Development Kit for [NAD](https://github.com/RoBroLabs/nad), plus the
source of every first-party plugin.

NAD ships with nothing installed. Administrators add capabilities as signed
`.nadmod` packages, each released independently of the Dashboard core. Plugins
run in a short-lived Deno sandbox with no direct network, filesystem, process or
runtime-import access — every outbound call and every notification is brokered
by the core against capabilities the plugin declared up front.

## Installing plugins

You do not need this repository to use plugins. Install them from inside NAD,
either from the Marketplace or by uploading a `.nadmod` file. NAD verifies the
signature and the declared capabilities before anything runs.

This repository exists so that anyone can read the source of what they are
installing, and so that anyone can build their own.

## Layout

```text
devkit/packages/     SDK, testkit and the nad-module CLI
devkit/schemas/      The contract source of truth for plugin manifests and UI
devkit/templates/    Scaffolds for v2 Apps and Add-ons
devkit/examples/     Worked examples, including host-service usage
devkit/docs/         Authoring guides, specs, compatibility and testing policy
devkit/distribution/ Contents of the downloadable Devkit archive
plugins/official/    Source for the first-party plugins
policies/            Review, publishing and signing policy; public trust keys
```

## Building a plugin

Requirements are pinned in `.node-version`, `.deno-version` and the `packageManager`
field of `package.json`; [`devkit/docs/TOOLCHAIN.md`](devkit/docs/TOOLCHAIN.md)
explains why each is exact.

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm ci:gate
```

Start from [`devkit/docs/APP_SPEC_V2.md`](devkit/docs/APP_SPEC_V2.md) for schema-v2
Apps and Add-ons, which is what new integrations should use. Schema v1 remains
supported and is specified in [`devkit/docs/MODULE_SPEC.md`](devkit/docs/MODULE_SPEC.md).

To produce the standalone Devkit archive, which carries its own SDK, testkit and
CLI tarballs and needs no registry access:

```bash
pnpm devkit:build
pnpm devkit:verify
pnpm devkit:clean-room
```

The result is a deterministic `dist/NAD-Plugin-Devkit-<version>.zip` containing no
plugins, keys, compiled tests or source maps.

To check generated contracts against a local NAD checkout, pass its path:

```bash
node devkit/scripts/generate-contracts.mjs --check --core ../nad
```

## Signing and trust

Every released package is Ed25519-signed. Public trust roots and their
fingerprints are in [`policies/trust-keys/`](policies/trust-keys/); private keys
are never held in a repository, build context or CI variable.
[`policies/RELEASE_KEYS.md`](policies/RELEASE_KEYS.md) covers generating your own
signing key, packing a signed release and verifying one.

Report a suspected signature or verification vulnerability privately using
[`SECURITY.md`](SECURITY.md) rather than opening a public issue.

## Contributing

Contributions are welcome for the Devkit and for plugins. See
[`CONTRIBUTING.md`](CONTRIBUTING.md).

## Licence

`AGPL-3.0-only`. See [`LICENSE`](LICENSE).
