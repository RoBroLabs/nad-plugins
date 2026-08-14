# NAD App development guide

- This is a schema-v2 App. Keep credentials in core-owned named connection profiles.
- Read only the invocation's selected connection through `HostApiV2.connections`.
- Route network access through a signed HTTP scope and `HostApiV2.http`; never import a network client.
- Keep public operation names, versions, permissions, surface IDs and binding IDs stable.
- Custom surfaces run in an opaque-origin sandbox. Use only the transferred MessageChannel bridge.
- Never place secrets in source, fixtures, diagnostics, bridge messages or operation responses.
