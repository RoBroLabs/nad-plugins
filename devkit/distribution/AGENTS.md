# NAD custom plugin workspace

Build custom NAD packages only inside `custom-plugins/`. Read
`docs/APP_SPEC_V2.md`, `docs/COMPATIBILITY.md` and `docs/TESTING.md` before
changing contracts or capabilities.

- Prefer schema-v2 Apps and Add-ons. A Widget or page is a surface inside one of
  those package kinds, not a separate executable package kind.
- Use the typed Host API and UI bridge clients. Do not access NAD cookies,
  sessions, raw secrets, the host filesystem or unrestricted network APIs.
- Request the smallest permissions, capabilities and HTTP scopes required.
- App credentials belong to named NAD connection profiles. Add-ons invoke the
  owning App through NAD and never receive those credentials.
- Notifications are dispatched through the central NAD notification service;
  do not add SMTP, Telegram or ntfy credentials to a plugin.
- Keep fixtures synthetic and never place credentials, private keys, `.env`
  files, `.nadmod` artifacts, `node_modules` or build output in source control.
- Run `pnpm check:all` before packing or sharing a package.
