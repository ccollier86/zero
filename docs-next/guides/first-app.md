---
id: zero.guides.first-app
type: tutorial
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: first-app
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [single, multi, simple-RBAC, advanced-RBAC, single-topology, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Create Your First Zero Application

[Guides index](./index.md) · [Documentation index](../index.md)

This is a new-project procedure, not permission to regenerate an existing app.
Commands below are operational examples; this documentation pass did not run
creation or app startup against a real project.

## 1. Pick A Fresh Target

For the current source/local release channel, install the local tools once from
the trusted Zero checkout, as described in
[local installation](../cli/tooling/local-install.md). Then create from the
selected committed-main archive:

```sh
zero-release --status
zero-new ./example-app --name example-app
cd example-app
bun run typecheck
```

The saved `zero-new` wrapper installs dependencies and records exact package
provenance in `zero-release.json`. It does not use an active feature checkout.
Review the trusted starter/package scripts before allowing dependency execution.
The lower-level `create-zero` path has a separate explicit `--install` option;
do not conflate its behavior with the saved wrapper. The
[creation guide](../cli/tooling/create.md) explains templates and force safety.
Do not assume public npm availability from source/local qualification.

## 2. Inspect The Starter, Not Assumptions

The package-mode starter separates zero.config.ts, app/server.ts, app/layout.tsx
and shared db/schema.ts. It uses public package imports. Configuration declares
services; the server entry composes/listens.

The inspected starter defaults to public/auth-disabled until
ZERO_AUTH_ENABLED=true. Its app database defaults hot; its system database
defaults file. Those are template choices, not universal configuration defaults.
Do not expose a starter as a finished authenticated product.

If enabling its auth path, configure the operator-held AUTH_BOOTSTRAP_SECRET and
the intended public/registration paths. That environment name is read by the
starter's config, not a general automatic Guardian binding.
Read [bootstrap](../backend/guardian/bootstrap.md) before visiting an empty app.

## 3. Make Ownership Explicit

Use shared defineTable declarations rather than maintaining separate server/
browser schemas. Add resource exposure and server policy for each transported
table. A loading mode or hidden field does not protect data.

Start with [user-owned records](./user-owned-records.md), or select the
[organization model](./organization-app.md) before building records around a
single-user assumption.

## 4. Compose The Frontend Once

AppProvider connects the app client, routing, Sync, modals and authorization
scope behavior. Use the generated layout/hydration entry rather than making
another client on every page. Theme and notification providers are separately
configured when needed.

Use [schema-driven controls](./reactive-control-plane.md), then customize the
app's columns, actions and page layout—not authentication transport.

## 5. Verify Before Opening A Deployment

Run the app-owned typecheck and inspect any Doctor script before executing it;
Doctor imports trusted config and can inspect database state. Start only with
explicit disposable paths for a smoke fixture. Check anonymous denial,
bootstrap/login, accepted writes, realtime delivery and scope replacement.

[Verification](./verification.md) distinguishes type evidence from runtime and
deployed security behavior. [Upgrade guidance](./upgrade.md) preserves that
distinction when returning to an existing application.

## Related Guides And Next Steps

- [Mode selection](./choose-modes.md) sets the independent architecture axes.
- [Configuration](../backend/configuration/index.md) owns exact accepted settings.
- [Scheduling and Calendar availability](../backend/calendar/configuration.md#availability-in-normal-projects)
  separates released cron/Jobs/workers and UI from the unfinished appointment
  backend; creating a new app does not import a feature branch or demo state.
- [Agent onboarding](../agents/index.md) accelerates use-first implementation.
