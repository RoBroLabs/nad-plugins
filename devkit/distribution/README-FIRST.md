# NAD Plugin Devkit

This folder is a self-contained workspace for building NAD Apps, Add-ons,
Widgets and full-page surfaces. It contains no first-party plugins.

## Start here

1. Install the pinned Node.js and pnpm versions shown in `VERSION`.
2. Run `pnpm run setup`.
3. Create a package in `custom-plugins/`:

```bash
pnpm create:app -- custom-plugins/my-app --id dev.example.my-app --name "My App"
pnpm create:addon -- custom-plugins/my-addon --id dev.example.my-addon --app dev.example.my-app
pnpm create:widget -- custom-plugins/my-widget --id dev.example.my-widget --name "My Widget"
pnpm create:page -- custom-plugins/my-page --id dev.example.my-page --name "My Page"
```

4. Run `pnpm install` after adding a package, implement it, then run
   `pnpm check:all`.

Open this extracted folder in Codex or another coding agent and describe the
service, data and UI you need. `AGENTS.md` gives the agent the non-negotiable
security and compatibility rules.

Local packages are supplied from `tooling/*.tgz`; `@nad/sdk`, `@nad/testkit` and
`@nad/cli` do not need to be published to npm. Normal third-party dependencies
such as TypeScript and AJV are resolved according to `pnpm-lock.yaml`.
