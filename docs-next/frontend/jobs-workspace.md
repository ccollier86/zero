---
id: zero.frontend.jobs-workspace
type: reference
audience: [developer, agent, operator]
owner: scheduler
status: draft
visibility: internal
system: frontend
feature: durable-jobs
maturity: planned
applies_to: ["Unreleased feature/core-worker-runtime-upgrades source; not a selected updater archive"]
reviewed_against:
  package: "@zero/framework"
  version: "2.10.5"
  commit: "62971773c682915e3b8f230f1458ba142779f7b5"
  snapshot: dirty
  date: "2026-11-15"
  evidence_level: source-observed
---

# JobsWorkspace

[Frontend index](./index.md) · [Durable jobs contract](../backend/scheduler/durable-jobs.md) · [Foundation plan](../_work/durable-jobs-and-workers-plan.md)

This is the native current-scope schedule and execution-history view under
development. It is not yet a qualified release or an alternative workflow
executor. Place it in an AppShell content pane under the application's shared
AppProvider. Keep that provider mounted during router navigation.

```tsx
import { JobsWorkspace } from '@zero/framework/frontend';

export default function JobsPage() {
  return <JobsWorkspace className="h-full" definitionLabels={{
    'reports.daily': 'Daily reports',
  }} />;
}
```

Enable the server's optional `jobs` configuration and register the exact
versioned definitions/workflows first. A UI component cannot enable the service,
grant a role or select another tenant. Unsupported API-key/anonymous jobs
admission does not become available by rendering this view.

## Native behavior

- A stable DataTable server source uses offset paging, twenty rows by default,
  native page-size selection, rolling totals and ordinary page/live motion.
- All/active/paused/cancelled filtering is server-owned. Unsupported full-text
  search, client-page-only sorting and bulk controls are deliberately absent.
- Scoped live pages invalidate stable queries through `refreshKey`; they do not
  fabricate database INSERT events or reload the entire workspace for a new row.
- The selected schedule shows its timing, time zone, recovery/overlap policy,
  next due time, closed blocked reason and separate execution state. History is
  independently read in twenty-occurrence pages. Authorized committed-change
  hints revalidate the inspector even if that job is off the visible table page
  or a history change leaves the bounded latest/active summary unchanged.
  Equal-page authority rechecks do not fabricate such change notifications.
- A paused schedule can still have older accepted work running. One active
  representative is not a count of all concurrent work. Workflow completion is
  not proof that an email/provider delivered an external effect.
- Details, row actions and retained pages are withdrawn on an unusable live read;
  account/scope/client replacement retires old callbacks before publication.
  Retry here means retry an authorized **read**, not resubmit a mutation.
- Confirmations use Zero's modal manager, actual trigger geometry and default
  motion. No copied dialog or independent overlay manager is required.

## Controls and honest outcomes

Pause/cancel/resume/run-now controls use the server's advisory action availability;
the server revalidates authority and revision at the actual operation. A manager
may stop another actor's schedule but cannot impersonate that actor to readmit it.

The confirmation captures its original action, schedule ID, revision and a single
idempotency key. Rapid clicks cannot dispatch twice. Accepted results close the
confirmation; an explicit rejection keeps its safe error visible. A changed
revision requires inspecting current data and deliberately preparing another
operation, not a hidden automatic retry.

An uncertain result remains visibly unresolved. **Check outcome** reads only
`client.jobs.receipts.get(originalKey)`. A null receipt is not evidence that the
write did not happen; it never enables a new key or replay. Busy and unresolved
confirmations cannot be dismissed as though the server rolled back. Navigating
away/replacing authority retires this in-memory surface; it does not undo the
server operation or provide a durable browser intent journal. Applications that
need cross-navigation recovery must explicitly retain their request identity
outside this view and reconcile using the same supported receipt API.

**Run separately now** creates a new one-off schedule under the initiating user's
current authority. Its accepted receipt has a different schedule ID. It does not
rewrite the original occurrence, undo cancellation or retry a failed external send.

## Configuration and composition

`JobsWorkspaceProps` supports:

| Prop | Responsibility |
| --- | --- |
| `title`, `description`, `className` | Page copy and constrained AppShell layout. |
| `definitionLabels` | Human-readable labels keyed by exact registered definition name. |
| `renderOwner(ownerId)` | Optional authorized profile/directory presentation; no credentials or owner impersonation. |
| `renderRun(workflowId)` | Optional authorized Torrent link/presentation. Jobs access does not grant workflow-control access. |
| `onCreate(definitions, trigger)` | Optional application-owned validated creation editor. Receives permitted metadata, never parsers or seals. |
| `onEdit(detail, trigger)` | Optional application-owned editor, shown only when current server prerequisites allow update. |

No creation/edit button is invented when its callback is absent. Definitions may
require domain-specific input, so the native workspace does not pretend arbitrary
JSON is a validated form. Application editors use the same `client.jobs` facade,
current revision, stable request identity and unknown-outcome rules. They should
reuse the modal manager and validate input against their own code-owned contract.
Callback code must retain its own scope/lifecycle fence before accepting delayed
work; supplied UI labels/renderers never become authorization decisions.

Implementation family: `src/components/jobs/`. The workspace is the public facade;
presentation parts and the in-memory confirmation controller are internal
composition details. No separate authentication client or tenant selector is used.

## Qualification boundary

The working branch includes in-memory controller checks and a short-lived
synthetic transport/browser fixture. Those are not substitutes for real managed
Guardian/Fabric/Torrent, bundled Linux deployment or final installed-archive
qualification. The foundation plan records actual results and remaining gates.
The preview script owns its fixture root/server and cleans them on normal exit,
SIGINT, SIGTERM and its ten-minute deadline; no preview is retained by default.
