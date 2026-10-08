---
id: zero.frontend.modals.workflow-progress
type: reference
audience: [developer, agent]
owner: modals
status: draft
visibility: internal
system: modals
feature: workflow-progress
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, standalone, Guardian single, Guardian multi, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Durable Workflow Progress In A Modal

[Modals index](./index.md) · [Documentation index](../../index.md)

ModalWorkflowProgress is optional presentation for an **already admitted**
Torrent run. Mounting/reopening the body does not start a run, infer a workflow
from an ordinary mutation, or replay an operation. This is the unreleased
structured-modal integration.

## Observe An Owned Run

This browser event fragment requires normal authenticated AppProvider composition,
an existing authorized run ID and its registered workflow name:

~~~tsx
import { ModalWorkflowProgress, modals } from "@zero/framework/react";

export function openRunProgress(runId: string, workflowName: string, trigger?: Element) {
  return modals.show({
    title: "Build progress",
    trigger,
    body: <ModalWorkflowProgress runId={runId} workflowName={workflowName}
      capabilities={{ cancel: true, pause: true, resume: true }} />,
    footer: { start: "Closing this view does not cancel the build." },
    actions: [{ id: "close", label: "Continue in background", role: "cancel" }],
  });
}
~~~

Capabilities are domain-supplied UI hints, not permissions. Server policy still
decides whether cancel/pause/resume is supported and authorized. Omit unsupported
capabilities; controls appear only in valid current status/readiness.

Props are runId, workflowName, optional capabilities(cancel/pause/resume) and
className. Retain the scoped run ID in app state/domain history for reopening.
Do not confuse “start accepted” or “pending” with completed external work.

## Readiness And Progress

The body composes useWorkflowRun with the optional useWorkflowObservation hook.
Observation reports idle/loading/ready/unavailable/reconnecting/offline/error/retired.
It performs authenticated status reconciliation without polling or publishing
response data into the Sync store. A connected socket or absent local row alone
does not establish resource availability.

Only ready, known root-node totals make progress determinate. Root nodes,
fanout items and interaction delivery steps retain separate denominators.
Terminal completed/failed/cancelled status wins over a rounded percentage;
100% progress alone is not a completion receipt.

Reconnection/explicit Refresh status reconciles reads through the current
authenticated SDK. Offline/unknown state does not show fictitious zero success
or treat “not in local cache” as deletion. Unavailable does not disclose whether
a resource is nonexistent or forbidden.

## Close, Cancel And Recovery

Closing/unmounting stops this view's observation; durable work can continue.
Cancel run is a separate explicit server action, and cancellation does not undo
effects already performed. The UI does not automatically retry a start or write.

Action admission is single-flight for the current run/scope. Safe action failures
ask the user to refresh status before deciding whether a retry is appropriate;
unknown outcomes are not proof that the requested transition never happened.
Authority/selection changes suppress obsolete completion messages.

The progress body does not automatically accept the surrounding modal when a
run finishes. The application chooses whether a terminal state is acknowledged,
a result is needed, or the view remains open for inspection. Domain results may
require their own authorized result endpoint; public redacted workflow fields
are not a substitute.

## Related Guides And Next Steps

[Workflow hooks](../torrent/hooks.md) owns selection/actions;
[backend HTTP](../../backend/torrent/http-api.md) owns admitted transitions;
[lifecycle](./lifecycle.md) explains view settlement;
[scope retirement](./scope-transitions.md) keeps ownership current.
