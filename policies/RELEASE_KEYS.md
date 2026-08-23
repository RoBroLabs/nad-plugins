# Release key custody and rotation

NAD Module releases use Ed25519 package signatures. Generate and keep private
keys outside Git repositories, build contexts, Dashboard data and Marketplace
images. Commit or distribute only public keys and their stable key IDs.

For local development, generate a disposable key pair with OpenSSL:

```bash
umask 077
openssl genpkey -algorithm ED25519 -out "$PWD/nad-local-private.pem"
openssl pkey -in "$PWD/nad-local-private.pem" -pubout -out "$PWD/nad-local-public.pem"
```

Move the private key to an encrypted, access-controlled location before using
it beyond a disposable exercise. Do not paste it into prompts, logs, shell
history, CI variables printed by a job or `release-metadata.json`.

Build and verify a signed package:

```bash
nad-module pack ./my-module --out ./dist \
  --signing-key /secure/path/nad-private.pem \
  --key-id my-publisher-2026-01 \
  --require-signature

nad-module verify ./dist/my-module-0.1.0.nadmod \
  --trusted-key ./nad-public.pem \
  --key-id my-publisher-2026-01
```

NAD trusts an exact public-key fingerprint configured by an administrator. A
signature proves package integrity and signer identity; it does not by itself
mean Robro Labs reviewed the code. Marketplace review attestations and package
signatures are separate decisions tied to the exact artifact digest.

If a private key may be compromised, stop using it, publish a signed key
revocation through the Marketplace security feed and sign subsequent releases
with a new key ID. Never reuse the old ID for a different key.

## Custody rules

- Generate and use production private keys in an offline or equivalently
  isolated signing environment.
- Keep at least two encrypted recovery copies under separate physical or
  administrative control. Test recovery with public-key verification, never by
  publishing a package.
- Restrict signing access to release maintainers. A reviewer records approval;
  a signer signs only the approved revision and release metadata.
- Never store a private key in Git, CI, Dokploy, the Marketplace image, a NAD
  data volume, ordinary backups, logs, evidence, prompts or shell history.
- Record the public key ID, SPKI SHA-256 fingerprint, creation date, owner,
  intended use and retirement state. A key ID is permanently bound to one key.

## Planned rotation

Rotate with an overlap. Do not remove an old trust root while supported
packages still require it.

1. Generate the new key offline and independently confirm its public-key
   fingerprint.
2. Commit only the public key and fingerprint documentation.
3. Release NAD core with both the current and new public keys trusted.
4. Prove that exact core release accepts packages signed by both keys and
   rejects an unknown key.
5. Begin signing new Modules with the new key ID.
6. Retain the old public key for the published compatibility/support window.
7. Retire the private key from signing use; do not delete historical public
   verification material.

Metadata-signing keys for the Marketplace follow the same overlap, but are a
separate trust domain. Never use one private key for both package and metadata
signing.

## Suspected compromise

1. Stop signing and promotion immediately; preserve audit evidence.
2. Determine the affected key ID, release digests and earliest possible
   exposure time.
3. Prepare a new offline key and ship its public root through a reviewed NAD
   core update if it is not already trusted.
4. Publish signed security metadata revoking the compromised key. Use
   `quarantine` for releases that cannot remain trusted; do not silently delete
   local configuration, history or artifacts.
5. Rebuild, review and sign clean replacement releases from known source.
6. Publish operator guidance and verify warning/quarantine behavior on a
   disposable Dashboard before closing the incident.
