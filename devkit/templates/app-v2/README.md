# __PACKAGE_NAME__

Schema-v2 NAD App scaffold for `__PACKAGE_ID__`.

Named connection profiles are owned and encrypted by NAD core. The server receives only the profile selected for the current invocation. NAD renders the connection selector outside the isolated Widget; the Widget displays the selected profile from bridge context and never receives credentials.

The starter surface already handles loading, empty, degraded, failed and revoked
states, light/dark theme context and bounded resize requests. Keep those paths
when replacing the sample summary.

Run `pnpm build`, `pnpm test`, and `pnpm check` before packing.
