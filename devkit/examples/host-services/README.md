# Safe Host API examples

This example shows a bounded mutation using core-owned storage, notifications
and audit annotations. It does not hold notification-provider settings, access
the network directly or write to the filesystem.

`manifest.json` declares the exact capabilities, write permission, mutation
audit action and a storage migration from `0.1.0` to `0.2.0`. The handler uses a
request ID as an idempotency key so a retried action does not emit the same
notification twice. Tests assert successful and duplicate behaviour from the
fake-host logs.

Use these patterns selectively. A read-only Module should not request mutation,
storage, notification or audit capabilities merely because this example does.
