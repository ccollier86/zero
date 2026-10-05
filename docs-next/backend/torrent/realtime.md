---
id: zero.torrent.realtime
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: realtime
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

# ReactiveDB Sync And Safe Workflow Progress

[Torrent](./index.md) · [ReactiveDB](../reactive-db/index.md) · [Documentation index](../../index.md)

Torrent writes tracked system-plane progress through ReactiveDB. Authorized
Sync delivers updates to subscribed frontend collections immediately after
accepted commits; the browser does not execute the workflow.

## Public Tables

WORKFLOW_TABLES contains workflow_instances, workflow_steps, workflow_events
and workflow_interactions. These are read-only progress projections, not direct
browser mutation endpoints. WORKFLOW_SERVER_TABLE_NAMES also includes private
definition/runtime/attempt/lease/memory/receipt state that must not cross Sync.

For every format—legacy and graph—public instance/step input, output and raw
error are null; event payload is null. Steps also hide wait_event,
private item_key and activation_key. Safe labels, statuses, counts, timestamps,
version/fingerprint and public path metadata remain.

Ordinary HTTP reads use the same projection. Being authenticated/manager does
not turn progress transport into a raw prompt/secret/result viewer.
Authorized definition administration is a different boundary.

## Ownership And Live Revocation

createWorkflowSyncPolicyAdapter({ getDB, delegate?,
resolveManagementAccess? }) composes workflow ownership with an app's Resource
policy. Deny-wins composition keeps delegated table denial and ANDs row filters.
Private tables stay excluded; public writes are rejected.

Parent ownership controls child steps/events/interactions.
In advanced multi-tenant RBAC, peer access needs live management resolution;
compatibility tenantRole alone does not grant it. Delivery-time comparable
authority/fingerprints reject stale permissions instead of preserving cached
cross-user rows after revocation.

Managed composition installs the adapter on the system data plane. Do not
publish these tables as generic app/Fabric resources to bypass parent-derived
ownership.

## Topology Versus Status

WorkflowService.getPublicTopology and GET /:id/topology return payload-free
immutable presentation topology. It omits executable handler IDs, condition
ASTs, private request schemas, bodies and activation keys.
Nodes include stable path/id/kind/label, parentPath and branchKey; edges describe
presentation connections.

Join topology.path to public workflow_steps.node_path. For each child, root
node identity can repeat at another path; path/stepId/itemIndex are suitable
public identity, not private item keys.

The frontend topology hook fetches one run's topology; live hooks update status.
No packaged full workflow graph editor/viewer is implied by these primitives.

## Verification And Related Guides

Observe an authorized synthetic run in two sessions, mutate its status, then
switch/revoke tenant scope. Verify rows and old action/topology callbacks clear,
and no private table/payload leaks. Read-only Sync mutation rejection must hold
even if an app shows an edit control.

[Frontend hooks/visualization](../../frontend/torrent/index.md) explain browser
composition. Read [HTTP](./http-api.md), [authority](./authority.md)
and [activities](./activities.md) for safe backend integration.
