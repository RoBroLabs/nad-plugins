#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exercise_root="$(mktemp -d)"
trap 'rm -rf "$exercise_root"' EXIT

cd "$repository_root"
devkit_version="$(node -p "JSON.parse(require('fs').readFileSync('package.json', 'utf8')).version")"
devkit_archive="dist/NAD-Plugin-Devkit-${devkit_version}.zip"
pnpm devkit:build
cp "$devkit_archive" "$exercise_root/first.zip"
pnpm devkit:build
cmp "$exercise_root/first.zip" "$devkit_archive"

node devkit/scripts/verify-devkit.mjs \
  "$devkit_archive" \
  --extract "$exercise_root/extracted"
devkit_root="$exercise_root/extracted/NAD-Plugin-Devkit-${devkit_version}"

for archive in "$devkit_root"/tooling/*.tgz; do
  if tar -tzf "$archive" | grep -E '(\.map$|\.test\.(js|d\.ts)$|\.tsbuildinfo$|generated/community/|schema-validation-community\.|dist/community\.|collection\.generated\.|review-attestation\.generated\.)' >/dev/null; then
    printf 'Forbidden compiled test, Marketplace workflow, or build metadata in %s\n' "$archive" >&2
    exit 1
  fi
done

pnpm --dir "$devkit_root" run setup
pnpm --dir "$devkit_root" create:app -- \
  custom-plugins/clean-room-app --id dev.robrolabs.clean-room-app --name "Clean Room App"
pnpm --dir "$devkit_root" create:addon -- \
  custom-plugins/clean-room-addon --id dev.robrolabs.clean-room-addon \
  --app dev.robrolabs.clean-room-app --name "Clean Room Add-on"
pnpm --dir "$devkit_root" create:widget -- \
  custom-plugins/clean-room-widget --id dev.robrolabs.clean-room-widget --name "Clean Room Widget"
pnpm --dir "$devkit_root" create:page -- \
  custom-plugins/clean-room-page --id dev.robrolabs.clean-room-page --name "Clean Room Page"
pnpm --dir "$devkit_root" install --no-frozen-lockfile --strict-peer-dependencies
pnpm --dir "$devkit_root" check:all

printf 'Self-contained Devkit clean-room exercise passed.\n'
