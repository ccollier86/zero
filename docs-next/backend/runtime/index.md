---
id: zero.runtime
type: index
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: overview
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [managed-server, standalone-extension]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Managed App Runtime And Server Extensions

[Backend index](../index.md) · [Documentation index](../../index.md)

Use `createApp` to compose Zero's app-local runtime. Use named declarative
extensions to add transport and service integration. Elysia owns HTTP validation,
hooks and plugin composition; services own business behavior. The runtime keeps
ownership, authority projection and teardown explicit.

## Build And Extend

- [Composition](./composition.md): an app-owned configuration and small Bun
  entry point; startup is separate from listening.
- [Endpoints](./endpoints.md): validated inputs, explicit access and typed
  handler context.
- [Routers](./routers.md): named groups, prefixes and inherited access.
- [Middleware](./middleware.md): applicability versus enforcement, trusted
  predicates and request-local identity.
- [Plugins](./plugins.md): async setup, Elysia dependencies and privileged setup
  versus scoped request services.
- [Configuration](./configuration.md): extension options and managed path defaults.
- [Discovery](./discovery.md): file/export conventions, deterministic ordering
  and the fact that importing app modules executes code.
- [Request services](./server-services.md): live scoped service access and
  deliberate privileged boundaries; physical selection is not business policy.
- [Machine services](./machine-services.md): verified machine/background
  credentials with mandatory live fences and no unsafe service bag.
- [Data planes](./data-planes.md): application versus system handles and local
  identity anchors for user-owned application records.
- [Lifecycle](./lifecycle.md): startup/readiness ordering and owned cleanup after
  partial construction failures.
- [Shutdown](./shutdown.md): awaited extension drains before provider disposal,
  process signals and crash-recovery boundaries.
- [Observability](./observability.md): safe HTTP failures, app-local event codes
  and attributed diagnostics without secret payloads.
- [Roadmap](./roadmap.md): proposed server-only scaffolding/plugin ergonomics,
  not invented configuration flags.

The [service-boundary concept](../../concepts/service-boundaries.md) explains
the shared authority model; [data planes](../../concepts/data-planes.md) explains
where managed authority and application records live.

## Philosophy

The inspected design favors explicit app-local ownership over an ambient
current-app singleton, declaration over repeated transport/auth scaffolding,
thin handlers over mixed business/persistence code, and awaited lifecycle work
over detached shutdown callbacks. These are architectural observations, not a
promise that raw app-owned Elysia/SQL automatically receives every platform guard.
