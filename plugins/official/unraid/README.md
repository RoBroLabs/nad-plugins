# Unraid

Unraid is the official NAD read-only integration for the GraphQL API built into
Unraid 7.2 and later. It preserves the stable `unraid` Module identity while
running entirely as an independently installed, signed package.

## What it provides

- Hostname, Unraid/API/kernel versions, boot time, calculated uptime, CPU
  identity and utilization, and memory utilization.
- Array state and capacity, current parity-check status, bounded parity/data/
  cache disk rows, and user-share capacity rows.
- Docker container and VM counts plus bounded read-only tables.
- Useful partial responses when the GraphQL server returns both `data` and
  sibling-field `errors`; upstream error messages are never relayed.
- Three stable Dashboard Widgets: `unraid-status`, `unraid-array`, and
  `unraid-workloads`.

The package requires the native Unraid 7.2+ API shape documented at
<https://docs.unraid.net/API/how-to-use-the-api/>. It does not implement the
older community REST or WebGUI endpoints.

## Core-owned security boundary

The only signed network scopes are exact HTTP and HTTPS `POST /graphql`
requests to the configured host and port. Both scopes are marked with a
read effect and the `graphql-query` request-body policy. NAD core encrypts the
API key and injects it as `x-api-key` only after the target, method, effect, and
query body pass core validation. Module code receives only an opaque secret
reference and never sets, reads, or logs the credential.

Every committed GraphQL document is a named `query`. This release has no
mutation entrypoint, write permission, direct network client, browser code,
filesystem access, background worker, or notification provider.

## Configuration

Configure the package in **Settings -> Modules -> Unraid**:

- `server_host`: hostname or IP address only, such as `tower.local`.
- `scheme`: `https` by default or `http` for an explicitly local endpoint.
- `port`: `443` by default; set the port used by the Unraid WebGUI/API.
- `api_key`: a read-only key created in **Settings -> Management Access -> API
  Keys**.

Do not include a scheme, port, path, query, fragment, or credentials in
`server_host`. Configure those in their dedicated fields.

## Stable surfaces

- Module ID: `dev.robrolabs.unraid`
- Slug: `unraid`
- Permission: `view`
- Plugin Page: `/`
- Entrypoints: `overview`, `summary`, `storage`, `workloads`
- Widgets: `unraid-status`, `unraid-array`, `unraid-workloads`

Collections are capped at 256 rows, GraphQL errors at 16 sanitized paths, text
at bounded lengths, and all counts/byte values at JavaScript's largest safe
integer. Missing, empty, new enum, malformed, negative, non-finite, and very
large upstream values degrade to explicit `Unknown`, zero, `null`, or capped
values that remain valid against the signed response schemas.

## Development

From the monorepo root:

```bash
pnpm --filter @nad/module-unraid typecheck
pnpm --filter @nad/module-unraid test
pnpm --filter @nad/module-unraid build
pnpm --filter @nad/module-unraid check
```

All fixtures are local. Tests must not contact a real Unraid server.
