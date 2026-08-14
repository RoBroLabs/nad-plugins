# NAD App and Add-on package specification v2

This is the public developer contract for package schema `2`, Host API `2.x`
and UI API `2.x`. The normative machine-readable contract is in
[`devkit/schemas/v2/`](../schemas/v2/); generated declarations and validators are exported
by `@nad/sdk`. Schema-v1 Modules remain supported through their published
compatibility window and are documented in [`MODULE_SPEC.md`](MODULE_SPEC.md).

## Product kinds

- An **App** owns an integration boundary. It may declare named connection
  profiles, scoped upstream HTTP access, isolated server operations and its own
  Widget or page surfaces.
- An **Add-on** owns separately installable UI surfaces. It declares compatible
  App dependencies and invokes only their explicitly exported, versioned
  operations. It never receives an App's settings or credentials.
- A **Collection** is signed Marketplace metadata grouping selectable Apps and
  Add-ons with an optional Workspace template. It is not executable and is not
  installed as a `.nadmod` package.

The archive extension remains `.nadmod`, and immutable package IDs, slugs,
permissions and stored database identifiers retain the existing Module aliases.

## Package boundary

A v2 App or Add-on is a deterministic, store-only ZIP containing exactly its
declared files:

```text
manifest.json
ui/surfaces.json
ui/surfaces/*.html
schemas/connections.json             # App only, when connections are declared
schemas/operations/*.json            # when operations are declared
server/main.js                       # when operations are declared
checksums.json
signature.json
README.md
LICENSE
assets/icon.png
```

The v1 ZIP, checksum and Ed25519 signature-envelope safety rules still apply.
The v2 verifier does not use the legacy v1 signature fallback when validating a
new package. It rejects undeclared files, unsafe paths, bad checksums, unknown
signers under a trusted-signature policy, forbidden runtime imports and custom
UI that is not self-contained.

## Manifest and compatibility

`manifest.json` uses `schemaVersion: 2` and `kind: "app" | "addon"`. It
declares core, Host API and UI API ranges independently. The canonical v2
contract digest is generated into `contract-lock.generated.json`; release
records include that digest so core and Marketplace cannot silently interpret
different contracts.

An App can declare:

- `connections`, pointing to `schemas/connections.json` and allowing unlimited
  core-owned named profiles;
- exact `httpAccess` scopes used by the core HTTP broker;
- `operations`, each with its own semantic version, consumers, connection
  requirement, permission, handler, schemas, limits and mutation audit action.

An Add-on declares `dependencies`. Every dependency has a stable alias, an
immutable App ID, a compatible App package-version range and an allowlist of
operation names with version ranges. Surface bindings can target only `self` or
one of these aliases. Core verifies the installed App version, exported
operation version, caller access, selected profile and operation schemas before
dispatch.

## Named connections and secrets

`schemas/connections.json` is a bounded JSON Schema with `x-nad` presentation
metadata. NAD owns profile names, access policy, encryption and storage. A
Widget or page holds only a connection-profile ID for a declared connection
slot. The App runtime can inspect the selected profile summary and read its own
fields through `HostApiV2.connections`; a secret read yields an opaque
`SecretReference`, never plaintext. Add-ons and browser surfaces never receive
connection values or secret references.

An App with upstream I/O declares signed scopes and uses
`HostApiV2.http.request`. The core broker resolves the selected profile, injects
the declared credentials and enforces scheme, host, port, method, path,
parameters, headers, query keys, body policy and read/write effect.

## Versioned operations

Operations form the App extension API. Their names are stable within an App and
their versions follow semantic versioning independently of the package version.
`consumers` declares whether the App's own surfaces, dependent Add-ons, or both
may call the operation. A mutation requires `auditAction`; runtime calls and
outcomes are still audited by core even when an App adds safe contextual
metadata through `HostApiV2.audit.annotate`.

An isolated handler receives an `AppRequestV2` and capability-gated
`HostApiV2`. The v2 broker exposes only:

- selected connection access;
- scoped HTTP;
- core-owned notification dispatch;
- per-App storage;
- bounded diagnostics;
- audit annotation;
- dependency operation invocation.

It does not expose NAD sessions, raw provider credentials, filesystem access,
environment variables, subprocesses or unrestricted network access.

## Sandboxed UI surfaces

`ui/surfaces.json` declares resizable Widget and full-page surfaces, permissions,
connection slots, operation bindings and requested execution. Each surface
entry is self-contained HTML/CSS/JavaScript and defaults to an opaque-origin
sandbox. It receives no NAD cookies, session, DOM access, raw settings or
network permission.

Core transfers a dedicated `MessagePort` with a random session ID. Every bridge
envelope includes bridge version `2`, that session ID, a bounded message ID, a
known direction/type and a payload. Core accepts only declared bindings and
privileges, validates request/response schemas, applies server-side RBAC and
rate/size limits, and can revoke access immediately. A removed surface or
profile renders a safe unavailable state; an existing Workspace reference does
not preserve data access.

`execution.requestedMode: "trusted"` is a request, not authority. Trusted mode
depends on the administrator policy and a valid exact-artifact-digest review
attestation for that release. Unreviewed manual uploads remain sandboxed unless
an administrator explicitly approves the exact digest.

## Release and review metadata

A signed v2 package plus `release-metadata.json` produces a deterministic
schema-v2 release record containing the complete verified manifest, package
digest and size, signer, contract digest, source provenance, changelog and
conformance results. Provider-neutral source URLs are optional.

Review attestations are separately signed Marketplace documents. Their payload
binds package ID, slug, version, artifact digest, source revision, contract
digest, review time, verdict and approved execution mode/privileges per surface.
Changing any package byte requires a new attestation. Publisher signatures prove
origin; review attestations decide eligibility for trusted execution.

## Developer commands and references

After building the workspace CLI:

```bash
nad app create ./my-app --id community.example.my-app
nad addon create ./my-addon \
  --id community.example.my-addon \
  --app community.example.my-app \
  --app-version ">=2.0.0 <3.0.0"

nad check ./my-app
nad pack ./my-app --out ./dist
nad verify ./dist/my-app-0.1.0.nadmod
```

`nad-module` remains a documented alias for v1 authoring and for the shared
check/pack/verify commands. Schema dispatch comes from `manifest.json`; the CLI
does not reinterpret a v1 package as v2.

[`devkit/templates/app-v2/`](../templates/app-v2/) is the generic reference App
with a sandboxed Widget surface. [`devkit/templates/addon-v2/`](../templates/addon-v2/)
is the generic UI-only Add-on. Provider-specific proof fixtures remain with
their private first-party plugin and are not part of the public Devkit.
