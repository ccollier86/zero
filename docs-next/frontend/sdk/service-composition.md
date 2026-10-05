---
id: zero.frontend.sdk.service-composition
type: reference
audience: [developer, agent]
owner: frontend-sdk
status: draft
visibility: internal
system: frontend-sdk
feature: service-composition
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose Existing Platform Service Hooks

[SDK index](./index.md) · [Documentation index](../../index.md)

Service hooks share the integrated client, scope boundaries and authenticated
transport, while each domain retains its own behavior. A public hook is not
proof its server feature is enabled.

- [Guardian UI/SDK](../guardian/index.md) covers login/account/tenant/API-key control
  flows, gates and adaptive management.
- [Data Studio](../data-studio/index.md) covers organization logical tables.
- [Notifications](../notifications/index.md) covers admitted notice/receipt lists,
  actions and optional toast presentation.
- [Rooms](../rooms/index.md) covers scoped room membership and topic presence.
- [Torrent](../torrent/index.md) covers workflow monitoring/actions/visualization.
- [State](../state/index.md) covers durable per-user state and ephemeral topics.

Choose the corresponding normal server configuration/permissions. Frontend props/
hidden controls do not mount an HTTP service, provision a realm or grant roles.
For app-owned endpoints use [client HTTP](./http.md)/[typed API](./typed-api.md)
instead of custom token headers. Keep route/service business policy server-owned.

Read/loading/optimistic/accepted behavior differs by facade; follow its authoritative
guide. A generic mutation wrapper cannot turn a discarded promise into a receipt
or make an ambiguous external action exactly once.

## Related Guides And Next Steps

- [SDK configuration](./configuration.md) owns client creation/request settings.
- [AppProvider](../runtime/app-provider.md) owns shared contexts.
- [Mutations](./mutations-and-connection.md) owns app command presentation.
