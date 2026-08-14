# Plugin review policy

Every published plugin release is approved as an exact source revision and exact
artifact digest. Approval never carries forward automatically to changed bytes.

Reviewers verify the manifest, permissions, capabilities, HTTP scopes, secret
boundaries, UI bridge messages, dependency inventory, hostile-input tests,
deterministic package output and source-to-artifact provenance. Contributor
binaries are not review inputs. Release infrastructure rebuilds from the
reviewed public source snapshot and signs only the verified result.

Official plugins remain private Preview candidates until they pass live install,
configuration, restart persistence, hot update, rollback and backup/restore
evidence. Community publishing remains disabled until isolated untrusted CI,
manual review, attestations, advisories, yanking and revocation are operational.
