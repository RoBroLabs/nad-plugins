# __PACKAGE_NAME__

Schema-v2 NAD Add-on scaffold for `__PACKAGE_ID__`.

This Add-on consumes the `summary` operation from `__APP_ID__` through NAD core. The browser surface receives neither App configuration nor credentials. NAD renders the connection selector outside the isolated surface; render only the selected profile summary received through bridge context.

The starter surface includes loading, empty, degraded, failed and revoked states,
light/dark theme context and bounded resize requests. Preserve those behaviours
when replacing the sample summary.

Run `pnpm build` and `pnpm check` before packing.
