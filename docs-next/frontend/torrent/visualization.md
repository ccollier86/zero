---
id: zero.torrent.frontend.visualization
type: how-to
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: frontend.visualization
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

# Visualize Live Workflow Progress Safely

[Torrent frontend](./index.md) · [Hooks](./hooks.md) · [Documentation index](../../index.md)

Combine immutable safe topology with authorized live step state. Do not copy a
private definition graph or event payload into the browser just to draw status.

## Topology Hook

useWorkflowTopology(instanceId: string | null) returns topology, isLoading,
error and reload(). It makes one authenticated HTTP read per selected run/
authority boundary, with explicit reload after failure. Topology is immutable
for that run; live status comes from useWorkflow separately.

SSR/no-client fallback does not start a browser request. Superseded/unmounted
loads cannot replace current state. A response with a different instanceId is
rejected. Scope/run change hides old topology immediately rather than showing
another organization's cached graph while loading.

## Join By Public Path

WorkflowPublicTopology contains instanceId/name/format, schemaVersion,
definitionVersion, graphFingerprint, entry, nodes and edges.

Node fields: id, path, kind, label, parentPath, branchKey.
Edge fields: presentation id, from/to, branch/order/default.
Executable activity names, private conditions, schemas, request bodies and
secret inputs are omitted.

Join node.path to workflow_steps.node_path. Legacy projection normalizes path
to durable step ID. Each children can share a definition node ID at different
paths; use public stepId/itemIndex/path rather than private item_key or
activation_key.

## UI Composition

Render independent named parallel lanes and distinguish running, waiting,
retrying, completed/skipped, failed, paused and cancelled states.
Show root progress separately from each-item and interaction delivery counts.
A paused run must not look active just because a child was previously running.

Complete minimal safe outline component:

```tsx
import { useWorkflow, useWorkflowTopology } from "@zero/framework/react";
export function WorkflowOutline({ instanceId }: { instanceId: string | null }) {
  const live = useWorkflow(instanceId);
  const map = useWorkflowTopology(instanceId);
  if (map.isLoading) return <p>Loading workflow layout…</p>;
  if (map.error) return <button onClick={map.reload}>Retry layout</button>;
  return <ol>{map.topology?.nodes.map(node => {
    const state = live.steps.find(step => step.node_path === node.path);
    return <li key={node.path}>{node.label}: {state?.status ?? "pending"}</li>;
  })}</ol>;
}
```

A sophisticated each monitor may show child counts rather than pretending
every item is one immutable topology node. This outline is intentionally small,
not a promised packaged designer or graph renderer.

## Actions And Validation

Use useWorkflowActions/useWorkflowRun for authorized controls and pending/errors;
do not edit read-only progress rows inline. UI gates complement server
authority. Clear selection, pending UI and old layout on organization changes.

Test a real synthetic run with parallel/wait/item work, update status live, then
switch/revoke scope and ensure old UI disappears. No private payload is required.

Related: [realtime](../../backend/torrent/realtime.md),
[authority](../../backend/torrent/authority.md),
[control flow](../../backend/torrent/control-flow.md), [hooks](./hooks.md).
