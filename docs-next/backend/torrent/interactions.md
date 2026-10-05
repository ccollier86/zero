---
id: zero.torrent.interactions
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: interactions
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

# Request-And-Wait Across Web, Email And SMS

[Torrent](./index.md) · [Events](./events.md) · [Documentation index](../../index.md)

requestAndWait adds an interaction to a durable wait: request metadata,
optional delivery activities, schema validation, an optional validator activity
and a bounded rejection policy. It can ask for input through an app UI, email,
text or an agent channel; the transport remains app-owned.

## Descriptor

Complete standalone flow descriptor, requiring registered delivery/validator
activities before compilation:

```ts
import { flow, requestAndWait } from "@zero/framework/workflows";
import { t } from "elysia";

export const approval = flow(requestAndWait("approval", "approval-reply", {
  label: "Review request",
  timeoutMs: 300_000,
  inputSchema: t.Object({ approved: t.Boolean() }),
  request: { title: "Approve this operation" },
  delivery: [{ name: "approval.notify", version: "1" }],
  validator: { name: "approval.validate", version: "1" },
  maxRejections: 3,
}));
```

request may be JSON or an expression. delivery accepts activity names,
references or { activity, input? } invocations. Delivery code can render the
request into an email/widget/SMS; no built-in transport is inferred.
maxRejections defaults 10 and is capped at 1,000.

A validator receives the submitted payload through an ordinary trusted
activity context. It may accept/reject according to the interaction service
contract, returning boolean or `{ valid: boolean, value?, code?, publicMessage? }`.
`value` is an optional normalized accepted value. Only messages intentionally safe for the responder
should be returned. Delivery/validation context carries the interaction.

## Response Identity And Authority

The authenticated route is
POST /workflows/:id/interactions/:interactionId/responses.
Supply submissionId, payload and optional channel. It returns accepted,
rejected or superseded outcome with safe interaction metadata, and applicable
rejectionCode/publicMessage—not private accepted payload/storage records.

Keep the same submissionId when retrying the same logical submission.
A changed body/identity for an already-used submission conflicts rather than
silently overwrites. A different genuine response gets a new submission ID.
Only one accepted response can decide a still-open interaction.

WorkflowInteractionAuthority is the policy boundary. Its default callback
denies. An app/Guardian adapter receives interaction/instance/node IDs,
authenticated actor, responderPolicy and abort signal. An async allow decision
must supply a synchronous final-commit assertion, optionally bound to revision;
a synchronous policy can be re-evaluated at commit.

Do not authorize using client-provided role arrays, a public interaction ID,
or a hidden UI button. HTTP supplies live Guardian actor information; the
captured assertion remains valid only until current authority changes.

## Lifecycle

Status is open, accepted, expired, cancelled or rejection_limit. Pausing aborts
in-flight interaction authorization/validation; responses cannot advance a
paused workflow. Resume can report WORKFLOW_DRAINING while old work settles.
Expiry/rejection ceilings are durable, not only UI timers.

Request data, response schemas/validator references, payloads and receipts are
private execution state. Public Sync exposes safe label/status/timing/counters.
An app requiring a response form must render its own authorized request UI/
transport, not assume those private records are a public collection.

## Verification And Related Guides

Test invalid then valid response, duplicate same submission, competing
responders, authority revision changing before commit, delayed validator
after pause/cancel and exact instance/tenant routing.
[Authority](./authority.md), [activities](./activities.md),
[HTTP](./http-api.md) and [realtime](./realtime.md) cover related boundaries.
