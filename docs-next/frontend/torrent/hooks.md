---
id: zero.torrent.frontend.hooks
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: frontend.hooks
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

# Authenticated Workflow Hooks

[Torrent frontend](./index.md) · [Backend HTTP](../../backend/torrent/http-api.md) · [Documentation index](../../index.md)

useWorkflow/useWorkflowList read authorized Sync collections.
useWorkflowActions sends authenticated Eden requests.
useWorkflowRun composes actions/live selection/progress.
useWorkflowTopology loads immutable presentation topology.
No hook executes trusted activities in the browser.

## Observe One Run

useWorkflow(instanceId: string | null) returns instance, ordered steps,
activeSteps, interactions, events and currentStep, plus isRunning/isComplete/
isFailed/isPaused/isCancelled/isWaiting/isWaitingForInput/isRetrying/
isRunningInParallel.

Child rows are meaningful only while their authorized parent is visible and
tenant identity matches. Terminal runs have no active current step.
A retrying failed step with retry_at can be active; waiting interactions are
not necessarily the same as a running activity.

useWorkflowList({ status?, name? }?) returns instances/count sorted newest
first. It filters the current authorized local collection; it is not a
cursor-paginated server query or a count of inaccessible runs.

## Actions

useWorkflowActions exposes:

| Action | Result |
| --- | --- |
| start(name, input?, { version? }?) | Promise<string> instance ID. |
| cancel/pause/resume(instanceId) | Promise<void>. |
| sendEvent(instanceId, eventName, payload?) | Promise<boolean> matched/claimed at that time. |
| submitResponse(instanceId, interactionId, payload, { submissionId?, channel? }?) | Accepted/rejected/superseded safe result. |

submitResponse defaults a new UUID per call. Preserve an explicit submissionId
when retrying the same logical submission; new attempts must not accidentally
create a different replay identity. A matched false event may be durably stored.

Actions reject while authorization scope changes and fence returned results
against the captured boundary. Backend policy remains decisive; an enabled
button is not permission.

## Run Hook And Progress

useWorkflowRun(name, { instanceId?, version? }?) exposes live fields plus
instanceId, progress, start, selected cancel/pause/resume/event/response,
starting, actionPending, actionError and setInstanceId.

Omitted instanceId uses local last-started selection. Explicit null deliberately
observes no run. An explicitly provided ID controls selection. Scope changes
clear old local selection and reject stale action completion.

progress top-level counters mirror rootNodes. fanoutItems and deliverySteps
are separate groups so dynamic each children do not inflate the stable graph
denominator. Counts include totalSteps, completedSteps (completed or skipped),
failedSteps, runningSteps (running or waiting), and rounded percent.

Complete component, requiring an authorized AppProvider and registered server
definition:

```tsx
import { useWorkflowRun } from "@zero/framework/react";
export function RunStatus() {
  const run = useWorkflowRun("request-reply", { version: 1 });
  return <section>
    <button disabled={run.starting || run.actionPending}
      onClick={() => { void run.start({ message: "synthetic request" }).catch(() => undefined); }}>
      Start workflow
    </button>
    <p>{run.instance?.status ?? "No run"} · {run.progress.rootNodes.percent}%</p>
    {run.actionError ? <p role="alert">The workflow action failed.</p> : null}
  </section>;
}
```

The hook retains actionError for presentation; the catch avoids an unhandled
event-handler promise. A successful start is not completed external work.

## Privacy And Related Guides

Public input/output/error/event payloads are redacted for every format.
Do not read those null fields as a result API. Private memory, prompts,
authority seals, responses and definition internals are not collections.

[Visualization](./visualization.md) covers topology; [runtime providers](../runtime/index.md)
covers scope/SSR; [backend events](../../backend/torrent/events.md) explains
delivery; [realtime](../../backend/torrent/realtime.md) owns server projection.
