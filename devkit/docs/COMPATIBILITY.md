# Compatibility and deprecation policy

NAD treats the package schema, Host API and UI API as independent compatibility
surfaces. A Module declares all three in its manifest. The SDK validates the
declaration; NAD repeats validation before install and activation.

## Versioning rules

- Additive schema changes remain within the current schema version only when old
  packages and validators continue to behave identically.
- Removing a field, changing its meaning or tightening valid published data
  requires a new schema or API major version.
- Host and UI APIs use semver ranges. A package may activate only when its range
  includes the installed NAD version.
- Published Module IDs, slugs, permission actions, entrypoint names, Widget IDs
  and page IDs are stable identifiers.
- Module configuration and storage changes require an explicit, exact-version
  migration when existing data must be transformed.
- App operation versions are independent semver contracts. An Add-on declares
  both a compatible App package range and ranges for every operation it uses.
- Exact-digest review attestations are release-specific and never carry forward
  automatically after an update.

## Deprecation

A public surface is documented as deprecated before removal. The Marketplace
release history records the first deprecated release and the replacement. Core
continues to execute compatible schema-v1 packages throughout the v1 support
window. Schema `1` and `2` are installed side by side in the SDK and selected by
the manifest version rather than silently reinterpreting v1. Existing `.nadmod`,
database and `/api/modules` identifiers remain compatibility aliases; the v2
user-facing kinds are App and Add-on. A schema-v1 Module maps to `kind: app` for
presentation but its signed manifest and runtime contract are never rewritten.

Security revocation is separate from deprecation. A revoked exact digest or key
is quarantined by NAD and produces an administrator warning; configuration and
retained artifacts are not silently deleted.

## Schema-v1 signature compatibility

The SDK always signs new packages with the canonical signature envelope. Core
and `nad-module verify` also recognise the earlier schema-v1 envelope used by
first-party releases through System Monitor `1.0.3`. Both forms authenticate the
same Module identity, version and complete checksummed file inventory; package
checksums, trusted-key lookup and Ed25519 verification remain mandatory. This
read-only fallback exists so an SDK correction does not strand an immutable
published artifact.

## Support matrix

| Package schema | Host API | UI API | Authoring status | Earliest removal |
|---|---|---|---|---|
| `1` | `1.x` | `1.x` | Frozen compatibility contract; supported aliases remain | 2027-08-13 |
| `2` | `2.x` | `2.x` | New Apps, Add-ons, named profiles and sandbox surfaces | No removal scheduled |

The schema-v1 contract remains supported for at least twelve months after the
0.3.0 release and will receive at least 180 days' notice before removal. A
published package that remains within its declared compatibility range is not
silently rewritten. Security quarantine of an exact artifact or signing key is
the only exception to normal compatibility activation.

Collections use signed Marketplace schema `1` metadata and contain no
executable artifact.

The contributor toolchain is tested with Node `20.20.x` and `22.22.x`, pnpm
`9.15.0`, and Deno `2.7.7` on Linux amd64 and arm64. Generated Module runtime
bundles target pinned Deno `2.7.7`. Other local environments may work but are
not release-gate configurations.
