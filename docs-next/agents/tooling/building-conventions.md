---
id: zero.agents.tooling.building-conventions
type: architecture
audience: [developer, agent, maintainer]
owner: agent-tooling
status: draft
visibility: internal
system: agent-tooling
feature: building-conventions
maturity: supported
applies_to: ["2.1.1 source; publication qualification pending"]
modes: ["coding-agent application development", "installed-package discovery"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose Zero Before Rebuilding It

[Tooling index](./index.md) · [Documentation index](../../index.md)

These guidelines summarize source-established integration patterns. They point
to owning contracts rather than maintain a second API reference.

## Responsibilities

| Layer | Agent responsibility |
| --- | --- |
| App config/schema | declarative settings and shared types; explicit mode/ownership choices |
| Elysia route/plugin/middleware | parse/validate/admit and delegate; use supported scoped services |
| Domain service | business transitions, accepted effects and error boundaries |
| Client SDK/hooks | shared authenticated transport, live queries and receipt semantics |
| Reusable UI | semantic tokens, public components, configured columns/actions/slots |
| Verification | focused contracts and evidence proportional to risk |

Bun-first means prefer appropriate Bun APIs. Node-compatible APIs are acceptable
where Bun has no direct suitable replacement; do not introduce a second Node
runtime. Use established Elysia composition/lifecycle rather than global hidden
state or routes bypassing injected service authority.

## Security And State

Guardian authenticates; backend permission/resource/service checks authorize
every operation. User/org IDs from arbitrary client data do not become trusted
Fabric selectors. Canonical user/security data stays in system.db; app-side
anchors support IDs/foreign keys and never grant permissions.

Wait for accepted mutations before success callbacks/closing editors. Fence
async results across account/tenant/authority replacement and unmount. Use
shared client/Sync integration rather than raw fetch/custom socket/local token
storage beside it.

Use standard safe domain errors and observability; do not log tokens, keys,
raw prompts, user records or confidential payloads. Split production files by
responsibility when concerns mix, not solely because a test is long.

## Discovery And Verification

Prefer public root/react/server or owning subpaths over node_modules/src,
private aliases or source-local exports. [Doctor rules](../../cli/doctor/source-audit.md)
can highlight suspicious usage but do not prove every boundary. Read
[verification](./verification.md) and the subsystem's focused tests.

For reusable component customization, use documented props/slots first; use
[zero add](../../cli/tooling/add.md) only when app ownership is deliberate.
[Design tokens](../../frontend/design-system/tokens.md) keep presentation coherent.
