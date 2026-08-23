# Plugin publishing

Marketplace publication is an operator-controlled promotion of reviewed source,
not an ordinary repository build. Private signing material never enters this
repository, CI, a Docker build context or an AI prompt.

## First-party release order

1. Freeze a clean, pushed source revision and export its reviewed public source.
2. Run the complete contract, test, build and hostile-input gates on the export.
3. Produce the `.nadmod` twice and prove the unsigned bytes are deterministic.
4. Sign the exact artifact with the offline first-party Ed25519 key.
5. Generate and verify its provider-neutral release record.
6. Upload the artifact to its immutable Marketplace object key without overwrite.
7. Fetch it through the public Marketplace origin and verify digest, size and signature.
8. Publish the source tag and optional GitHub Release mirror.
9. Advance signed catalogue and security metadata only after every identity agrees.

The release record must identify package ID, slug, version, compatibility,
permissions, capabilities, HTTP scopes, source revision/directory, digest, byte
size and signer. A correction always receives a new version. Revocations and
advisories are forward-signed records; published bytes are not silently replaced.

## Community publishing

Community intake is disabled. When enabled, submissions will be source-only and
namespaced under `plugins/community/<publisher>/<slug>`. Untrusted validation
runs without secrets. A human reviews the exact source and evidence before
trusted infrastructure rebuilds and signs the artifact. A contributor-supplied
binary is never promoted.

See `policies/RELEASE_KEYS.md` and `policies/REVIEW_POLICY.md` for the
detailed gates.
