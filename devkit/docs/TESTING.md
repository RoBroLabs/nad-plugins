# Module test and release checklist

Run this checklist from a clean checkout using a supported toolchain.

## Contract and behaviour

- [ ] `pnpm install --frozen-lockfile --strict-peer-dependencies` succeeds.
- [ ] `nad-module check <module-dir>` accepts the manifest, endpoint schemas,
      declarative UI and runtime bundle.
- [ ] Query and mutation handlers have focused tests using `@nad/testkit`.
- [ ] Every permission has an allowed and denied-role scenario.
- [ ] HTTP success, upstream failure, malformed data and timeout paths are
      represented by local fixtures; tests make no real network requests.
- [ ] Notifications, audit annotations and storage mutations are asserted from
      the fake-host logs without exposing secrets.
- [ ] Request and response byte bounds and hostile inputs are covered.

For a schema-v2 App or Add-on, also verify:

- [ ] `nad check <package-dir>` accepts the canonical manifest, connections,
      operations, surfaces and dependency bindings.
- [ ] At least two named profiles remain isolated and all secret reads are
      opaque references.
- [ ] Add-on dependency package/operation ranges are accepted when compatible
      and rejected when missing or incompatible.
- [ ] Surface messages with the wrong session, direction, binding, privilege,
      size or access state are rejected by the bridge harness.
- [ ] Browser surfaces receive no session, credentials, configuration or
      unrestricted network access and render a safe revoked/unavailable state.
- [ ] A trusted-mode request remains sandboxed without a valid exact-digest
      review attestation and the selected administrator trust policy.

## Preview and package

- [ ] `nad-module dev <module-dir> --once` reports pages, Widgets, roles,
      endpoint results, denials, errors, timeouts and captured host effects.
- [ ] The localhost browser preview renders every page and Widget in at least
      one successful, empty and error scenario.
- [ ] V2 surface HTML is self-contained and every binding/connection slot is
      exercised with `@nad/testkit` fixtures; UI-only Add-ons require no server
      bundle.
- [ ] Two clean `nad-module pack` runs produce byte-identical `.nadmod` files.
- [ ] `nad-module verify` succeeds with the intended public key and fails with a
      wrong key, changed byte, unsafe ZIP path and oversized input.
- [ ] The changelog and release record match the manifest version, source
      revision, checksum, size and signer.

## Dashboard exercise

- [ ] Install the package through manual upload on a disposable fresh NAD.
- [ ] Configure and enable it, assign least-privilege access and render a Widget.
- [ ] Install the next compatible version without restarting NAD.
- [ ] Configuration, permissions, layout and retained prior artifact persist.
- [ ] Rollback selects the retained release and its matching data generation.

Inside the downloadable Devkit, run `pnpm check:all`. In the private monorepo,
the complete release gate is `pnpm ci:gate`; release CI repeats it on Linux
amd64 and arm64 with the pinned Node, pnpm and Deno versions.
