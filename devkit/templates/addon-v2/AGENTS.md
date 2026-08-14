# NAD Add-on development guide

- This is a schema-v2 UI-only Add-on. It owns no connection credentials.
- Consume only operations and version ranges declared in `manifest.json` dependencies.
- Use only named surface bindings through the transferred MessageChannel bridge.
- Never request raw configuration, secret references, NAD sessions or provider credentials.
- Treat the package ID, dependency aliases, permission actions, surface IDs and binding IDs as stable.
- Test removed App, profile and surface access as a safe unavailable state.
