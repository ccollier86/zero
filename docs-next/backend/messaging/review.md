---
id: zero.messaging.review
type: reference
audience: [developer, agent, operator, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: durable-review
maturity: experimental
applies_to: ["feature/messaging-backend development checkpoint; not a stable update"]
---

# Durable Messaging Review

[Messaging index](./index.md) · [Implementation checkpoint](../../_work/messaging-backend-implementation.md)

This is the development branch's real native review contract, not a promise that
an older `2.6.0` archive contains it. The branch still needs its complete backend,
workspace, installed/Linux/browser and release qualification. Do not replace the
managed service with custom SQL or infer an unknown provider outcome from UI.

## Why Work Needs Review

An interrupted provider invocation might already have happened. Zero retains
that job and its attempt facts instead of quietly issuing another generation.
A received private result can also need review when publication could not be
completed. Provider confirmation is not customer delivery or human attention.

An assistant failure moves a still-current support conversation to triage.
Configured staff may discover the content-free support queue and explicitly
claim the conversation. A staff role alone does not grant private membership,
transcript, draft, attachment or review-history access.

Internal named-assistant conversations are independent of support. Their admitted
human owner can inspect and resolve that conversation's recovery facts without a
support role. A failure retains the old job/attempt and advances its epoch; a new
explicit human turn may proceed, but the uncertain old call is not automatically
retried. The same explicit retry/context/duplicate-acknowledgment rules apply.

## One Public Facade

Both the request-scoped `zero.messaging.review` and authenticated
`client.messaging.review` supply:

| Method | Contract |
| --- | --- |
| `list(conversationId, { after?, limit? }, options?)` | Current support staff members, or the internal bot conversation's admitted human owner; unresolved items, stable ID cursor, default 25/max 50, real `hasMore`/`nextCursor`. |
| `get(conversationId, jobId, options?)` | Same current conversation admission; safe reason, optional retained private draft, up to 25 attempt summaries, explicit `historyTruncated` and resolution. |
| `retry(conversationId, jobId, expectedOwnerEpoch, true, mutationOptions)` | Current human owner only; exact epoch, explicit possible-duplicate acknowledgment, still-current customer turn/context and configured assistant policy. |
| `dismiss(conversationId, jobId, expectedOwnerEpoch, mutationOptions)` | Current human owner only; records deliberate resolution without calling a provider. |

Mutation options require a stable `requestId`; optional `signal` cancellation
does not prove rollback. Reconcile an interrupted mutation through its original
identity/receipt rather than generating another request ID. The SDK does not
automatically retry a mutation. Callers never choose actor, tenant, model,
provider key, assistant instructions, workflow principal or job policy.

Retry creates a new ownership epoch and new job with the current configured
policy. The old job's reason and immutable attempt history remain unchanged,
linked by a separate resolution. Replaying the accepted intent cannot enqueue
another replacement. A newer customer turn, public edit/removal, archived
conversation, stale owner or lost membership rejects the retry. A new provider
call cannot be treated as reconciliation of an earlier unknown call.

Dismissal removes the item from unresolved listing. It does **not** relabel the
original uncertain effect as accepted, erase attempt history or manufacture a
delivery receipt. The current API retries assistant jobs only; unsupported
external deliveries remain review work rather than becoming a generic resend.

## Transport And Privacy

Native Guardian routes live under
`/api/messaging/conversations/:conversationId/review`, with item `/:jobId` and
`/:jobId/retry` / `/:jobId/dismiss` endpoints. Mutations use `Idempotency-Key`.
Native routes are no-store, bound to the server-selected current scope, closed
to extra body/query fields and subject to strict audit admission when enabled.
The browser never receives private lease nonces or raw provider errors.

Private realm migration `004` adds review resolutions and indexed discovery;
it is unrelated to historical core/SYSTEM migration `004`. The earlier private
migrations and stored outcomes are preserved. Read/publication membership is
rechecked after async actor and audit boundaries.

Explicit directory/conversation/history/contact/support/review reads use
configured `communications` audit capture. Evidence distinguishes admitted
attempts, prepared results, denied/failed/unknown outcomes. It contains safe
action/actor/scope/opaque conversation identity, not transcript, draft text,
search queries, prompts, results, filenames, keys or exception messages.
The final bounded projection is re-read after audit delivery before release.
Automatic post-mutation projections and live refreshes are not human views;
the live endpoint audits admission once per connection and still authorizes
every subsequent snapshot. No SQLite/auth-exclusive lease spans audit I/O.

## Development Evidence And Remaining Work

The native file/restart protocol checks exercise private retained drafts,
staff/customer isolation, claim/epoch guards, explicit retry acknowledgment,
immutable prior outcomes, exact replay, current-turn rejection and dismissal.
The managed HTTP/SDK scenario uses only a loopback synthetic provider and real
Guardian, private Fabric, Logging, Torrent and AI services. No real provider,
production app or live identity is used.

Those focused results do not qualify a complete messaging release. The managed
review workspace, native notification/channel delivery, public customer
admission and final installed/Linux/browser/update checks remain separate work.
