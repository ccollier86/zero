---
id: zero.torrent.legacy-workflows
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: legacy-workflows
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

# Legacy Sequential Workflows And Compatibility

[Torrent](./index.md) · [Authoring](./authoring.md) · [Documentation index](../../index.md)

WorkflowDefinition { name, steps, inputSchema?, access? } remains supported.
registerHandler registers activity version "1", databaseCallable: false.
Registry getWorkflow/listWorkflows and get/list aliases refer to legacy
definitions; getCompiledWorkflow/listCompiledWorkflows cover every format.

## Complete Registration

```ts
import { WorkflowRegistry } from "@zero/framework/workflows";
const registry = new WorkflowRegistry();
registry.registerHandler("normalize", async ({ input }) => ({ normalized: input }));
registry.registerHandler("save-reply", async ({ input, waitEvent }) => ({
  prepared: input, reply: waitEvent?.payload ?? null,
}));
registry.registerWorkflow({
  name: "legacy-reply",
  steps: [
    { name: "Prepare", handler: "normalize", retries: 3 },
    { name: "Save reply", handler: "save-reply", waitFor: "reply", timeoutMs: 60_000 },
  ],
});
```

This is a registry, not an authenticated running plugin. Previous output is next
input; original input remains workflowInput. Legacy gates supply waitEvent.

## Correctness And Trust

Dependent steps cannot bypass retrying predecessors. Early events are inboxed,
active waits receive deadlines, and pause/cancel abort/fence attempts.
Owner/scope/live authority apply to legacy as well as graph runs.

Legacy condition strings are trusted server configuration compiled with a
JavaScript Function at registration. They are not the new expression AST.
Never accept database/editor/user source text as a legacy condition.
Use expr/choose for new database/agent authoring.

Legacy definitions cannot declare immutable version/activate publication or
trusted private initialMemory/memoryLimits start options. Use graph definitions
for these features. Optional context fields retain type compatibility; runtime
provides signal/attemptId/idempotencyKey.

## Upgrade Checks

Managed Torrent schemas live on the system plane. Apps moving from an old
physically combined DB need the platform system/application migration plan;
package installation alone does not relocate history. Do not move/delete
existing tables blindly.

Progress is now payload-redacted for every format. An old UI reading
instance/step output, inputs or event.payload through ordinary Sync/HTTP needs
an explicitly authorized app result endpoint/private integration.
No general raw-result browser getter is promised.

Retain handler names used in persisted legacy snapshots. Verify old pending,
paused, waiting/retrying runs and backups before production updates.
This draft qualifies inspected 2.1.1 source, not release/1.3 artifacts.

Related: [authority](./authority.md), [events](./events.md),
[recovery](./recovery.md), [realtime](./realtime.md).
