# NAD Module package specification v1

> This specification is frozen for compatible schema-v1 packages. New Apps and
> Add-ons use [`APP_SPEC_V2.md`](APP_SPEC_V2.md). The `.nadmod` extension,
> immutable IDs and compatibility API aliases remain shared.

This document is the public contract for a NAD Module package. A Module author
does not need the NAD core source tree. The normative machine-readable contract
is the versioned JSON Schema bundle in [`devkit/schemas/`](../schemas/); generated
TypeScript declarations in `@nad/sdk` are derived from that bundle.

## Package boundary

A `.nadmod` file is a deterministic, store-only ZIP archive. Its paths are
relative, forward-slash separated and case-unique. It contains:

```text
manifest.json
checksums.json
signature.json
server/main.js
schemas/config.json
schemas/endpoints/*.json
ui/pages.json
ui/widgets.json
assets/*
```

`checksums.json` covers every payload entry except itself and `signature.json`.
`signature.json` is either a signed Ed25519 release envelope or the explicit
`unsigned-dev` form. Production NAD installations reject unsigned packages
unless an administrator deliberately enables the local development gate.

For signed schema-v1 packages, sort the checksum `files` object by archive path
and sign the UTF-8 bytes of compact `JSON.stringify` output for exactly this
object shape:

```json
{"moduleId":"dev.example.status","version":"1.2.3","digestAlgorithm":"sha256","files":{"manifest.json":"<sha256>"}}
```

The normative shape and cross-implementation fixture are in
`schemas/signature-envelope.schema.json`. The SDK packer/verifier and NAD core
both test against that generated fixture; a private alternative envelope is not
compatible even when it is internally self-consistent.

The verifier rejects path traversal, links and special files, duplicate or
case-colliding paths, overlapping entries, data descriptors, ZIP encryption,
unsupported compression, undeclared files, checksum mismatches and archive or
entry counts above the published limits.

## Manifest

`manifest.json` uses schema version `1`. Its `id` is an immutable reverse-domain
identifier; the human-readable `slug` may be used in URLs but must also remain
stable once published. Every release declares exact compatibility ranges,
capabilities with reasons, permissions, configuration fields and entrypoints.

An entrypoint is either a `query` or `mutation`. It binds one exported handler
to request and response schemas, a permission, request/response byte limits and
a timeout class. Mutations additionally require an `auditAction`. A handler
receives a `ModuleRequest` and the capability-gated `HostApi`.

Modules never receive NAD sessions, notification-provider credentials or raw
secret configuration. They use opaque secret references and call the central
host broker for HTTP, notification, storage and audit services. Runtime imports,
direct network access, filesystem access and subprocesses are forbidden.

Signed HTTP scopes may ask core to inject one declared secret into one exact
header, query parameter or JSON-body field. The Module still receives only
secret presence. Scopes also bind origin/port, exact or constrained path,
method, runtime header/query allowlists and a read/write effect. Read-effect
GraphQL POSTs accept query operations only; the broker rejects mutation and
subscription documents before making the upstream request.

## UI

Schema-v1 UI is declarative JSON. Pages and Widgets select an entrypoint as a
data source and render the supported element vocabulary. Packages do not ship
browser JavaScript, HTML or CSS. NAD enforces server-side permissions before it
returns endpoint data; hiding a surface is not an access-control mechanism.

## Data migrations

An update may declare one exact `fromVersion` to `toVersion` migration. Version
1 supports bounded declarative `rename`, `setDefault` and `delete` operations
for configuration and per-Module storage. Defaults for secret configuration are
forbidden. NAD applies migrations transactionally during activation and retains
the prior release and data generation for rollback.

## Release metadata

`release-metadata.json` contains the authored changelog, hot-update statement,
provider-neutral source coordinates and licence. A signed package plus that
metadata produces an immutable `*.release.json` record. Marketplace promotion
requires successful package, contract and trusted-signature checks; catalogue
fields are generated from the verified record rather than copied by hand.

## Normative versions

The current pins are package schema `1`, Host API `1` and UI API `1`. Use the
constants exported by `@nad/sdk`; do not duplicate these values in Module code.
See [`COMPATIBILITY.md`](COMPATIBILITY.md) for versioning policy.
