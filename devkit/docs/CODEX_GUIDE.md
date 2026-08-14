# Building a plugin with Codex

Extract the NAD Plugin Devkit, run `pnpm run setup`, then scaffold a v2 App or
Add-on inside `custom-plugins/`:

```bash
pnpm create:app -- custom-plugins/ups-app \
  --id community.example.ups \
  --name "UPS App" \
  --publisher "Example"

pnpm create:addon -- custom-plugins/ups-history \
  --id community.example.ups-history \
  --app community.example.ups
```

Open the extracted Devkit in Codex so its root `AGENTS.md`, contracts and local
tooling remain available. Ask the agent to edit only the chosen package. A
useful App prompt is:

> Build this NAD App to show status from my UPS API. Store settings only in
> named connection profiles, route all network calls through signed HTTP
> scopes, expose a versioned read operation for Add-ons, and keep secrets out
> of responses, diagnostics and fixtures. Build self-contained sandbox Widget
> and page surfaces using only declared UI bridge bindings. Test two named
> profiles, denial, malformed responses, timeout and access revocation. Run
> typecheck, tests, build and `nad check`.

For an Add-on, state the owning App and operations explicitly:

> Build a UI-only history Add-on for `community.example.ups`. Depend only on
> the `history` operation range declared in the manifest. Let users select an
> allowed connection profile, render a safe unavailable state when access is
> removed, and never request App configuration, secret references or direct
> network access.

The v1 workflow below remains valid during its compatibility support window.

Create the scaffold first, then open only that directory as the Codex workspace:

```bash
nad-module create ./ups-monitor \
  --id community.example.ups-monitor \
  --name "UPS Monitor" \
  --publisher "Example"
cd ups-monitor
codex
```

The scaffold includes its own `AGENTS.md`. Keep that file, `README.md`,
`manifest.json`, fixtures and schemas in the workspace so Codex can reason from
the public contract without access to NAD core.

A useful first prompt is:

> Build this read-only NAD Module to show status from my UPS API. Use only the
> provided SDK Host API, route network access through `http.request`, keep the
> token in a secret config field, validate external data, and add local fixtures
> and tests for success, denial, malformed responses and timeout. Update the
> declarative page and Widget. Run typecheck, tests, build, contract check and a
> one-shot preview. Do not add direct network, filesystem or subprocess access.

For a mutation, state the exact user action, permission and audit expectation:

> Add a `silence-alarm` mutation that requires `alarm.silence`, confirms the
> target in the request schema, invokes only the declared brokered HTTP scope,
> annotates safe audit metadata, and emits a core notification after confirmed
> success. Add denied-role, upstream-error and duplicate-request tests.

Review Codex changes before signing. In particular, inspect capability reasons,
HTTP scopes, secret handling, server-side input validation, error redaction,
timeouts, permission checks, migration declarations and generated package
contents. Never provide a production private signing key to Codex; sign only
after the reviewed clean-tree test gate passes.
