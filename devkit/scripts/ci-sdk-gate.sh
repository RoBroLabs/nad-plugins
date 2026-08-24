#!/usr/bin/env bash
set -euo pipefail

expected_machine="${EXPECTED_MACHINE:-}"
if [[ -n "$expected_machine" && "$(uname -m)" != "$expected_machine" ]]; then
  printf 'Expected architecture %s, got %s\n' "$expected_machine" "$(uname -m)" >&2
  exit 1
fi

node_major="$(node --version | sed -E 's/^v([0-9]+).*/\1/')"
if [[ "$node_major" != "20" && "$node_major" != "22" ]]; then
  printf 'Unsupported Node.js major: %s\n' "$node_major" >&2
  exit 1
fi
if [[ "$(pnpm --version)" != "9.15.0" ]]; then
  printf 'Expected pnpm 9.15.0, got %s\n' "$(pnpm --version)" >&2
  exit 1
fi
deno_first_line="$(deno --version 2>/dev/null | sed -n '1p')"
if [[ "${deno_first_line%% (*}" != "deno 2.7.7" ]]; then
  printf 'Expected Deno 2.7.7.\n' >&2
  exit 1
fi

pnpm contracts:check
pnpm lint
pnpm typecheck
pnpm test
pnpm build
# A clean workspace cannot link the CLI bin until its compiled entrypoint exists.
# Re-run the frozen linker from the populated local store; this performs no
# dependency resolution or network selection.
pnpm install --frozen-lockfile --strict-peer-dependencies --offline
pnpm check
pnpm preview:system-monitor
bash devkit/scripts/ci-clean-room.sh
pnpm devkit:build
pnpm devkit:verify
bash devkit/scripts/ci-devkit-clean-room.sh
pnpm pack:system-monitor:dev
# Derive the version from the manifest. Pinning it here meant the gate packed
# the new version and then verified the previous one, so any version bump
# failed the release gate on a file that had never been built.
system_monitor_version="$(node -p "require('./plugins/official/system-monitor/manifest.json').version")"
node devkit/packages/cli/dist/index.js verify "dist/system-monitor-${system_monitor_version}.nadmod"
deno check plugins/official/system-monitor/dist/server/server.js
deno run --no-config --no-lock --cached-only --deny-net --deny-env --deny-run --deny-write --deny-sys --deny-ffi --deny-import plugins/official/system-monitor/fixtures/runtime/deno-smoke.mjs
pnpm audit --prod
if git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  git diff --check
fi
