# Contributing

Community package intake is not open yet. Bug reports and improvements to the
Devkit contracts, documentation and test tooling are welcome once the public
repository is available.

Keep changes focused, use AGPL-3.0-only for contributed source and run:

```bash
pnpm install --frozen-lockfile --strict-peer-dependencies
pnpm ci:gate
```

Do not submit package binaries, private keys, credentials, generated build
directories or source copied from an unreviewed third party. Future community
packages will use source-only pull requests and the review boundary in
`policies/REVIEW_POLICY.md`.
