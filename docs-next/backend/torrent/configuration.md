---
id: zero.torrent.configuration
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: configuration
maturity: supported
applies_to: ["2.1.1 source baseline; not installed-package qualification"]
modes: ["authenticated single-tenant app", "Guardian multi-tenant app", "explicit trusted server composition"]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Configure And Register Torrent

[Torrent](./index.md) · [Platform configuration](../configuration/index.md) · [Documentation index](../../index.md)

Managed authenticated apps enable workflows by default. workflows: false
disables them. auth: false cannot enable managed workflows.
There is no workflows:true public setting: use omission, false or an
AppWorkflowsConfig object. No workflow-specific env variables are introduced.

## Managed Registration

AppWorkflowsConfig accepts register, onServiceCreated, shutdownGraceMs and
interactionAuthority. register(registry, { ai }) can be async and is awaited
before crash recovery and service publication. The AI context is the app-bound
AIService or null, not a browser credential.

Complete typed configuration value, not a standalone running installation.
`auth: true` explicitly enables Guardian defaults; omitting `auth` would disable
managed authentication and Torrent. Before exposing an empty installation,
configure and complete the [first-owner bootstrap ceremony](../guardian/bootstrap.md).
The default secret ceremony requires a server-configured secret; this example
does not provision an owner or invent a credential.

```ts
import type { AppConfig } from "@zero/framework/server";
import { flow, step } from "@zero/framework/workflows";

export const config = {
  auth: true,
  db: { mode: "file", path: "./application.db" },
  tables: {},
  workflows: {
    async register(registry) {
      registry.registerActivity({
        name: "records.normalize", version: "1", databaseCallable: true,
        async handler({ input }) { return { normalized: input }; },
      });
      registry.registerWorkflow({
        name: "normalize-record", version: 1,
        flow: flow(step("normalize", { name: "records.normalize", version: "1" })),
      });
    },
    shutdownGraceMs: 30_000,
  },
} satisfies AppConfig;
```

onServiceCreated(service) is a synchronous app-local binding seam after recovery.
Throwing aborts publication/rolls startup back. Do not store compatibility
process-global getters as if they selected the current request's app.

All Torrent tables—including private coordination/memory/version state—belong
to the managed system database, separate from application/Fabric business data.
Do not add workflow table schemas to a customer realm as a relocation strategy.

## Defaults And Runtime Phase

shutdownGraceMs defaults to 30,000 and accepts safe integers from 0 through the
native timer maximum, 2,147,483,647. This is cooperative handler drain grace, not
a guarantee that external remote work can be undone.

interactionAuthority controls human/agent response policy. It is a separate
policy from who may start a definition; see [interactions](./interactions.md).
Changing registered activities/configuration requires deliberate redeployment.
Current run lifecycle and database definition activation are live operations.

## Explicit Plugin Composition

createWorkflowPlugin(config, lifecycleOptions?) is the public Elysia plugin.
WorkflowPluginConfig requires db and optionally accepts runtime, scheduler,
register, onRegistryCreated, getTokenService, authorization, ensureAuthReady,
executionServices, shutdownGraceMs, interactionAuthority,
onInitializerCreated and onServiceCreated.

register is preferred over the compatibility synchronous onRegistryCreated.
Inject concrete app-local auth/Scheduler dependencies; otherwise compatibility
lookups are used. The plugin installs schemas, awaits readiness/registration,
constructs its owner-fenced service, recovers and only then publishes it.
It mounts /workflows; no configurable route-prefix property is provided.

Explicit lower-level composition does not automatically supply Guardian,
scope-closed services, persisted signing authority, app shutdown or Sync policy.
Do not copy a memory-only test service into production and assume it has managed
authentication/durability. [Runtime lifecycle](../runtime/lifecycle.md) and
[authority](./authority.md) explain required ownership.

## Compatibility Getters

getWorkflowRegistry()/getWorkflowService() return the most recently composed
compatibility-visible live owner, or null; they are not multi-app selectors.
stopWorkflowRuntime() drains that owner. Use app-bound request/service seams
for integrations requiring a particular app.

Related: [authoring](./authoring.md), [recovery](./recovery.md),
[lifecycle](./lifecycle.md), [configuration resolution](../configuration/resolution.md).
