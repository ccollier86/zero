---
id: zero.guides.extensions
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: extensions
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

# Extend Zero At Its Public Boundaries

[Guides index](./index.md) · [Documentation index](../index.md)

First find the existing service/component. A useful extension composes Zero's
authority, lifecycle and transport; it does not recreate a parallel token cache,
raw tenant selector or frontend fetch layer.

## Backend

defineEndpoint supplies validated Zero-native Elysia admission. defineRouter
groups inherited route requirements. Middleware contributes matching
cross-cutting behavior. Plugins receive trusted setup services and can register
their domain services/owned cleanup.

Keep handler, service, persistence and presentation responsibilities separate.
A raw Elysia escape hatch is trusted app code and owns its own enforcement.
It does not inherit a Resource policy merely because it uses the same table.

## Data And Optional Features

Share schema declarations with browser-safe code. Define Resource realm/exposure/
action policy server-side. Fabric realm contributions compose tables and
registered operations immutably; do not ship a private databases import or
arbitrary function source across IPC.

Use optional feature bundles exactly as documented. Data Studio, for example,
needs its complete backend bundle, not a fabricated dataStudio:true flag.

## Frontend

Use public components/hooks, semantic tokens, slots and accepted-operation
contracts. A new component can choose its layout without rebuilding authenticated
transport or treating a UI gate as a data policy. Keep provider/client ownership
clear and test old-scope callback cleanup.

## Verification And Distribution

Check public exports from the actual package, not an internal barrel.
Typecheck representative consumer examples, run focused contract tests and
record separately versioned SDK/plugin compatibility. No generic marketplace,
automatic discovery server or coding-agent MCP is implied by this guide.

See [runtime extensions](../backend/runtime/index.md),
[resources](../backend/resources/index.md), [Fabric composition](../backend/fabric/realm-composition.md),
[frontend](../frontend/index.md), [agent conventions](../agents/index.md)
and [verification](./verification.md).
