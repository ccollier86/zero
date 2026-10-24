---
id: zero.frontend
type: index
audience: [developer, agent]
owner: frontend
status: draft
visibility: internal
system: frontend
feature: overview
maturity: supported
applies_to: ["2.6.0 working source; individual system guides retain their own review metadata"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "335b27372b0b8ef57a1e92cf93cec378923fe50b"
  snapshot: dirty
  date: "2026-10-10"
  evidence_level: source-observed
---

# Build Interfaces With Zero

[Documentation index](../index.md)

Zero's frontend composes the authenticated client, realtime data projection,
file router and reusable design-system components. Application code chooses its
schema, data source, actions and page layout; server services and policies retain
the final authority over operations.

Start with the [UI reference](./ui-reference.md) for tokens, typography, motion
and component APIs. Use [Application UI development](../guides/application-ui-development.md)
for dashboards, settings and workspaces, or [Public UI development](../guides/public-ui-development.md)
for landing/content assembly. The guides route facade/part selection to full
manuals and distinguish working-source additions from older installed packages.

## Start With The Runtime

- [Runtime providers](./runtime/index.md) explains AppProvider, SSR-safe access,
  hydration, authorization scope fences and render errors.
- [Client SDK](./sdk/index.md) covers authenticated HTTP/Eden, reactive collections,
  exact accepted mutations and generated policy-aware resources.
- [Forms](./forms/index.md) covers headless state, generated controls, field context,
  step navigation and scope-aware accepted submission.
- [Router](./router/index.md) covers file/page/API conventions, loaders, inherited
  access, browser navigation and deliberate anonymous caching.
- [State](./state/index.md) covers durable user/org-principal state, explicit
  preference/form drafts and authorized ephemeral topics.
- [Modals](./modals/index.md) covers stack ownership, confirmations, exact dismissal
  and callback-free scope discard.
- [Generic hooks](./hooks/index.md) covers local interaction helpers distinct
  from domain/SDK hooks.
- [AppShell](./app-shell/index.md) composes navigation, workspace selection,
  account menus and header slots without owning their server authority.
- [Design system](./design-system/index.md) covers theme tokens, assets, motion,
  icon contracts and reusable component styling.
- [Reusable components](./components/index.md) covers focused primitive and
  presentation families alongside the domain control planes.
- [Zero Charts](./charts/index.md) explains the shared rendering/model/query API,
  chart-family selection, tokens and inspection, with links to full family manuals.
- [Guardian interfaces](./guardian/index.md) covers auth/account hooks, scope-aware
  gates, user/organization control planes and API-key management companions.
- [Data controls](./data-controls/index.md) covers source-aware tables, shared query
  controls, accepted editing/actions and reusable control-plane composition.
- [Data Studio](./data-studio/index.md) covers organization logical tables,
  revisioned inline editing, schema inspection and dedicated controller helpers.
- [Storage interfaces](./storage/index.md) covers scoped drive/file hooks,
  uploads, previews and adaptive list/detail/action control planes.
- [Notifications](./notifications/index.md) covers receipt hooks, optional toast
  provider and reusable inbox/badge controls.
- [Rooms](./rooms/index.md) covers scoped membership hooks and room/topic presence.
- [Messaging foundation](./messaging/index.md) covers experimental conversation
  parts and real session-scoped typing; the durable chat backend is still in development.
- [Email Inbox](./email/index.md) covers optional folder/message workspaces, safe HTML, rich composition, scoped drafts and live mail.
- [Frontend observability](./observability.md) covers browser sink/event integration
  and safe diagnostics without bypassing backend ingest authority.
- [Torrent interfaces](./torrent/index.md) covers workflow hooks and realtime run
  visualization without replacing the server executor's authority.
- [Schema](../backend/schema/index.md) supplies shared field validation, codecs,
  logical/stored types and form/table presentation metadata.
- [Runtime composition](../backend/runtime/index.md) explains how server plugins,
  service layers and application/tenant data planes connect to the browser.
- [Optional documentation reader](../plugins/docs/index.md) supplies a standalone
  public Markdown section using shared controls and public design tokens.
- [Guardian](../backend/guardian/index.md) owns authentication/authorization;
  frontend gates and controls improve presentation but never grant access.

This entrance grows with the SDK, router, data controls, forms and component
reference sections as their focused contracts are reviewed. A page being absent
from this draft index is not a promise that its feature is unavailable.

## Choose The Public Surface

The [Email Inbox](./email/index.md) is an additive working-source family over
the optional SMTP/IMAP modules. Its [configuration](./email/configuration.md)
is explicit; it is separate from chat and notification inboxes and is not
present in earlier installed archives merely because this guide exists.

`@zero/framework/react` and the root package expose the browser-safe frontend
barrel. `@zero/framework/server` is server-only. `@zero/framework/schema` is the
explicit declaration/type entrance. Some advanced or individual component/hook
surfaces have narrower package subpaths; use each guide's actual import rather
than an inferred path into node_modules internals.

Normal app components consume the integrated client through providers. Advanced
low-level Sync imports are separate and can have similarly named hooks with
different contracts. Do not open an extra socket or assemble duplicate auth
transport merely because both layers are public.

## Building Principles

These principles are inferred from the inspected integration:

1. Share a declaration and authenticated transport; compose UI without duplicating
   the server's policy or application data plane.
2. Keep logical form values separate from SQLite/wire encodings.
3. Wait for accepted writes before success notifications or finishing editors.
4. Treat identity/tenant/authority changes as cache and UI state boundaries.
5. Use reusable token-based components and their explicit extension points;
   hidden controls are not security controls.

Examples here describe inspected working source. They remain internal drafts
until independent source/example/artifact/navigation qualification completes.
