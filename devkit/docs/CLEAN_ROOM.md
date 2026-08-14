# Clean-room Devkit exercise

Use this exercise to prove the released Devkit without npm publication or a
sibling NAD repository.

1. Download the versioned Devkit ZIP and verify it against the published
   SHA-256 value.
2. Extract it into a new directory and run `pnpm run setup`.
3. Create an App, Add-on, Widget and page under `custom-plugins/` with the root
   scripts documented in `README-FIRST.md`.
4. Run `pnpm install`, then `pnpm check:all`.
5. Preview every surface with success, empty, denied, malformed-data and timeout
   fixtures. No fixture may make a real network request.
6. Pack a package twice into separate directories and compare both SHA-256 and
   byte size.
7. Generate a disposable Ed25519 key outside the workspace, sign one package
   and verify it using only the public key.
8. Install it on a disposable NAD instance, test configuration and permission
   persistence, then apply a compatible update without restarting NAD.

The repository command `pnpm devkit:clean-room` automates steps 1–4 from the
generated ZIP and rejects first-party plugins, signing keys, `.nadmod` files,
community-publishing APIs, source maps, compiled tests and build caches inside
the download.

Record tool versions, Devkit digest, package digests and NAD build information
for a real release. Never reuse the disposable key or installation as a
production trust root.
