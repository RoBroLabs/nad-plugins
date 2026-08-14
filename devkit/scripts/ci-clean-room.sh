#!/usr/bin/env bash
set -euo pipefail

repository_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
exercise_root="$(mktemp -d)"
trap 'rm -rf "$exercise_root"' EXIT

pack_root="$exercise_root/packs"
module_root="$exercise_root/read-only"
mkdir -p "$pack_root"

(cd "$repository_root/devkit/packages/sdk" && pnpm pack --pack-destination "$pack_root" >/dev/null)
(cd "$repository_root/devkit/packages/testkit" && pnpm pack --pack-destination "$pack_root" >/dev/null)
(cd "$repository_root/devkit/packages/cli" && pnpm pack --pack-destination "$pack_root" >/dev/null)

node "$repository_root/devkit/packages/cli/dist/index.js" create "$module_root" \
  --id dev.robrolabs.clean-room-status \
  --name "Clean Room Status" \
  --publisher "Clean Room Contributor"
node "$repository_root/devkit/scripts/use-local-sdk-tarballs.mjs" \
  "$module_root/package.json" "$pack_root"

pnpm --dir "$module_root" install --strict-peer-dependencies
pnpm --dir "$module_root" typecheck
pnpm --dir "$module_root" test
pnpm --dir "$module_root" build
pnpm --dir "$module_root" check
pnpm --dir "$module_root" preview:once > "$exercise_root/preview.json"
pnpm --dir "$module_root" exec nad-module dev . --once --role denied > "$exercise_root/denied.json"
grep -q '"status": "ok"' "$exercise_root/preview.json"
grep -q '"status": "denied"' "$exercise_root/denied.json"

pnpm --dir "$module_root" exec nad-module changelog . \
  --summary "Initial clean-room release." \
  --entry "Adds the read-only summary page and Widget." \
  --preserve "Module ID and permission" \
  --preserve "configuration keys" \
  --released-at 2026-08-11 \
  --source-directory clean-room/read-only

mkdir "$exercise_root/dist-a" "$exercise_root/dist-b" "$exercise_root/dist-signed"
pnpm --dir "$module_root" exec nad-module pack . --out "$exercise_root/dist-a"
pnpm --dir "$module_root" exec nad-module pack . --out "$exercise_root/dist-b"
cmp \
  "$exercise_root/dist-a/clean-room-status-0.1.0.nadmod" \
  "$exercise_root/dist-b/clean-room-status-0.1.0.nadmod"

umask 077
openssl genpkey -algorithm ED25519 -out "$exercise_root/private.pem"
openssl pkey -in "$exercise_root/private.pem" -pubout -out "$exercise_root/public.pem"
pnpm --dir "$module_root" exec nad-module pack . \
  --out "$exercise_root/dist-signed" \
  --signing-key "$exercise_root/private.pem" \
  --key-id clean-room-ci-2026-01 \
  --require-signature
pnpm --dir "$module_root" exec nad-module verify \
  "$exercise_root/dist-signed/clean-room-status-0.1.0.nadmod" \
  --trusted-key "$exercise_root/public.pem" \
  --key-id clean-room-ci-2026-01
pnpm --dir "$module_root" exec nad-module release-record . \
  "$exercise_root/dist-signed/clean-room-status-0.1.0.nadmod" \
  --out "$exercise_root/dist-signed" \
  --trusted-key "$exercise_root/public.pem" \
  --key-id clean-room-ci-2026-01 \
  --source-revision 1111111111111111111111111111111111111111

printf 'Clean-room SDK exercise passed.\n'
