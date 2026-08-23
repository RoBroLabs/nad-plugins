# Network

Network is the official NAD Pi-hole integration. It preserves the original
`network` Module identity while running entirely as an independently installed,
signed package.

## What it provides

- Pi-hole v6 application-password authentication and v5 API-token support.
- Aggregate query, blocked-query, block-rate, client, forwarding, cache, and
  blocklist statistics.
- Independent health and blocking state for a primary and optional secondary
  Pi-hole, including useful partial results when one target is unavailable.
- Permission-gated enable and disable operations, with an optional disable
  duration from 1 to 86,400 seconds.
- Per-target final-state verification and safe audit annotations for every
  mutation.

## Core-owned security boundary

NAD core encrypts both credentials and returns only opaque secret references to
the Module. The runtime never reads an API token or application password. The
signed HTTP scopes instruct core to inject a v6 password into `/api/auth` or a
v5 token into the `auth` query parameter after the Module request has passed the
exact host, port, path, method, query, header, and read/write checks.

The package implements no notification provider, authentication system,
settings page, browser JavaScript, direct network client, filesystem access, or
background worker.

## Configuration

Configure the package in **Settings -> Modules -> Network**:

- `pihole_url` and `pihole_api_key` are required.
- `pihole_api_version` is `v6` by default; select `v5` only for a legacy
  `admin/api.php` installation.
- `pihole2_url` and `pihole2_api_key` are optional but must be supplied
  together.
- URLs may point to the root, `/admin`, `/admin/api.php`, or `/api`. Embedded
  credentials, query strings, fragments, and custom paths are rejected.

## Permissions and stable surfaces

- `view` allows the Network Page, `dns-stats`, `dns-toggle`, and query
  entrypoints.
- `manage_dns` allows the audited `blocking` mutation.

Stable compatibility identifiers are `dev.robrolabs.network`, slug `network`,
Page `/`, and Widget IDs `dns-stats` and `dns-toggle`.

UI API v1 renders the `dns-toggle` Widget as a compact status surface. The
permission-gated mutation is already part of the package contract; an inline
Widget control requires a future reviewed declarative UI action element and
must not be implemented with package browser code.

## Development

From the monorepo root:

```bash
pnpm --filter @nad/module-network typecheck
pnpm --filter @nad/module-network test
pnpm --filter @nad/module-network build
pnpm --filter @nad/module-network check
```

All fixtures are local. Tests must not contact a real Pi-hole.
