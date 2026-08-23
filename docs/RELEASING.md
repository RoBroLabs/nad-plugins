# Releasing a plugin

Plugin versions are independent. A plugin releases on its own schedule, with its
own SemVer, and declares which NAD core versions it works with — nothing here is
tied to a core release.

Two properties hold the process together, and every step below exists to protect
one of them:

- **A published version is immutable.** Once bytes exist at a version URL they
  are never replaced, and that SemVer is never reused. A defect is answered with
  a new version plus a signed advisory, yank or revocation — never a quiet swap.
- **The signing key never touches CI.** It lives offline. CI proves the source
  builds reproducibly; a human signs the result somewhere else.

## Versioning and tags

Bump the version in **both** `manifest.json` and `package.json` — the release
build rejects the tag if they disagree, because `manifest.json` is the identity
NAD enforces at install time and `package.json` is what the workspace resolves.

Tag as `<slug>-v<semver>`:

```text
system-monitor-v1.0.4
proxmox-v1.1.0
```

The tag is a permanent claim that these bytes came from this source, so it is
recorded in the Marketplace catalogue and must never be moved. If you tagged the
wrong commit, cut the next patch version instead.

## 1. Prepare the source

Update the manifest version, `release-metadata.json`, the changelog, the
compatibility range, tests and fixtures together, then run the gate locally:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm ci:gate
```

Review the diff for the things a signature cannot catch: a stable module ID,
slug, settings keys, permissions, endpoint names and surface IDs; the smallest
Host API capabilities and the exact HTTP scopes the plugin actually needs;
secrets staying opaque to plugin code; bounded requests, responses, collections
and failures; and no runtime imports, install scripts or native code.

Widening a capability or an HTTP scope is a reviewable change even in a patch
release. It is the one thing a user cannot see for themselves before installing.

## 2. Tag, and let CI prove reproducibility

```bash
git tag system-monitor-v1.0.4
git push origin system-monitor-v1.0.4
```

[`release-plugin.yml`](../.github/workflows/release-plugin.yml) then checks the
tag against the manifest, runs the full SDK gate, and packs the plugin three
times — twice on the pinned Node line and once on the other supported one —
asserting all three produce identical bytes.

That cross-version check is the point of publishing source at all. A digest in
the catalogue is only meaningful if someone else can rebuild it and get the same
answer; if the bytes depended on which Node built them, that promise would be
void.

The run uploads a `<slug>-<version>-candidate` artifact: the **unsigned**
package, `provenance.json` and `PROVENANCE.txt` recording the source revision,
the digest and the reproducibility result.

You can dry-run any plugin without tagging through **Actions → Plugin release
build → Run workflow**.

### The unsigned digest is not the release digest

The signature is carried inside the package, so signing changes the bytes. The
CI digest proves the *source* is reproducible; the digest that identifies the
*release* comes out of the offline pack in the next step. Never publish the CI
artifact.

## 3. Sign offline — maintainer only

First-party releases are signed on an offline machine with an Ed25519 key whose
public half is already trusted by the target NAD core. Move the reviewed
revision across, then:

```bash
umask 077
release_out=$(mktemp -d)
source_revision=$(git rev-parse HEAD)

node devkit/packages/cli/dist/index.js pack plugins/official/<slug> \
  --out "$release_out" \
  --signing-key /secure/offline/first-party-private.pem \
  --key-id robrolabs-first-party-YYYY-MM \
  --require-signature \
  --release-record \
  --source-revision "$source_revision"

node devkit/packages/cli/dist/index.js verify \
  "$release_out/<slug>-<version>.nadmod" \
  --trusted-key policies/trust-keys/robrolabs-first-party-YYYY-MM.pub.pem \
  --key-id robrolabs-first-party-YYYY-MM
```

The private key is never printed, committed, uploaded to CI, or included in an
evidence bundle. [`policies/RELEASE_KEYS.md`](../policies/RELEASE_KEYS.md) covers
custody, rotation and compromise response.

Publishing your own plugin uses the same command with your own key. NAD installs
any package whose signature and declared capabilities verify.

## 4. Promote — maintainer only

Promotion happens in the Marketplace repository, which holds the catalogue and
the signed metadata. It takes the signed artifact, the generated
`*.release.json` record and the module dossier, and it will refuse the release
if the bytes do not match the signed record, if the signature does not verify
against the committed public key, or if that version was already published.

```bash
pnpm publication:promote \
  --artifact <slug>-<version>.nadmod \
  --release-record <slug>-<version>.release.json \
  --dossier data/modules/<slug>.json
```

That uploads the bytes to `downloads/<slug>/<version>/` and appends to the
publication ledger. Recommending the version and signing the catalogue metadata
are separate, deliberate steps afterwards.

## 5. Prove the published release

Download the public bytes into a disposable directory and verify them again with
`nad-module verify`. Confirm the catalogue and the download agree on module ID,
slug, version, compatibility, permissions, capabilities, source revision, signer,
SHA-256 and byte size.

Then install on a disposable NAD. For an update, prove hot activation, retained
rollback, and that settings, permissions and layout survive without restarting
core.

## When a release goes wrong

Do not delete or replace published bytes, and do not reuse the SemVer. Publish a
fixed version, then use the signed metadata channel to warn about the bad one:

| Situation | Action |
|---|---|
| Defect worth telling users about | Advisory naming affected and fixed versions |
| Version should no longer be offered for new installs | Yank |
| Bytes or a signing key can no longer be trusted | Revocation, targeting the exact digest or key |

Existing bytes stay available for audit and, unless critically revoked, for
explicit rollback. Quarantining a release must never silently delete an
administrator's configuration.
