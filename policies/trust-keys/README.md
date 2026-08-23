# First-party release trust roots

This directory contains public keys only. `robrolabs-first-party-2026-01` signs
the existing System Monitor releases. Its Ed25519 SPKI SHA-256 fingerprint is:

```text
9d2f673bab9d024accc4a7df5f7d7e3e8ba849a47387c71cac56a5554813a7b4
```

`robrolabs-first-party-2026-08` signs Phase 4 and later reviewed first-party
releases. Its Ed25519 SPKI SHA-256 fingerprint is:

```text
1cdf2bf13104d2a80d894dff24a95dc2d0ea5cec2cc9f5b825465b0928442b7a
```

Private release keys are kept outside this repository. Do not add private keys,
passwords, tokens, or CI secret exports here.

The operating procedure for key custody, planned overlap, compromise response
and retirement is in [`../RELEASE_KEYS.md`](../RELEASE_KEYS.md).
