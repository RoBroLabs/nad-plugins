# Security policy

NAD plugin packages execute code inside self-hosted Dashboard installations.
Treat path validation, signatures, declared capabilities, HTTP scopes, UI bridge
messages and release provenance as security boundaries.

Report vulnerabilities privately to the project maintainer. Include the affected
package or Devkit version, exact artifact digest when relevant, reproduction
steps and the expected impact. Do not include live credentials or private keys.

Supported versions are listed in `devkit/docs/COMPATIBILITY.md`. Preview
first-party plugins under `plugins/official/` are not public supported releases.
Security advisories and revocations are published by the signed Marketplace
metadata channel; NAD must not silently delete an administrator's configuration
when quarantining a revoked digest.
