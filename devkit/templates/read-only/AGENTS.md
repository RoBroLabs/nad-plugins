# Read-Only Module Guide

This scaffold is intentionally small and read-only.

- Keep server code on the NAD host API contract. Do not import Node, Deno, network, filesystem, or subprocess dependencies into `src/server.ts`.
- Prefer `config.get` for administrator-managed inputs before adding broader capabilities.
- Keep endpoint schemas, declarative UI files, fixtures, and tests aligned with the manifest entrypoints.
- Keep preview scenarios versioned under `fixtures/scenarios/*.v1.json` so `nad-module dev` stays deterministic in CI and the browser preview.
- Model secret config in preview scenarios with opaque `{ "secretRef": "...", "present": true }` objects only. Never place raw secret values in fixtures.
- Treat Module IDs, slugs, permission actions, and Widget IDs as stable compatibility surfaces once published.
