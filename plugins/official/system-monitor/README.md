# System Monitor Module

Read-only official NAD Module for host status and Node Exporter metrics.

Configuration:

- `hosts`: comma-separated `name|host` entries.
- `check_method`: `node_exporter` or `http`.
- `node_exporter_port`: shared metrics port, default `9100`.

The Module never opens sockets directly. It requests configured host URLs
through NAD core's `http.request` capability, and NAD core owns destination
policy, timeouts, byte limits, and error sanitisation.

Release `1.0.3` keeps the existing Module ID, slug, view permission, config
keys, Page path, and Widget IDs intact. It adds one administrator-only
notification test action which requests delivery through NAD core; the Module
owns no SMTP, ntfy, or other channel configuration.

The signed manifest grants exactly two HTTP broker scopes: `GET` requests to
`http://{hosts}:{node_exporter_port}/metrics` and `GET` requests to
`http://{hosts}:80/`. No other scheme, port, path, or method is permitted.

The release command emits a signed package using a private key supplied from
outside this repository. `pack:system-monitor:dev` is the separate unsigned
path for local contract testing against a Dashboard whose development gate is
explicitly enabled. Signed release builds can also emit a provider-neutral
`*.release.json` record with changelog, provenance, digest, and conformance
details for publication tooling.
