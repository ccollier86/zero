---
id: zero.work.messaging-backend-implementation
type: roadmap
audience: [developer, agent, maintainer]
owner: messaging
status: draft
visibility: internal
system: messaging
feature: durable-messaging
maturity: experimental
applies_to: ["feature/messaging-backend; not a selected stable update"]
---

# Durable messaging implementation checkpoint

[Working index](./index.md) · [Messaging architecture](../backend/messaging/index.md)

Finish and qualify publishing first, then the native logging investigation UI,
then this subsystem. Worktrees isolate their release candidates. No production
application, database, migration or deployment is changed by these fixtures.

## Implemented private persistence slice

`src/messaging/realm.ts` is a side-effect-free named Fabric realm. Its dedicated
actor entry imports no application configuration. Closed tracked commands own
conversations, bounded membership, accepted contact requests, independently
owned blocks, monotonic read positions, messages, revisions/tombstones, reactions,
support claims and ownership epochs. Durable intent receipts outlive transport
receipt retention. Every read/write rechecks canonical membership; server-issued
authority will be bound by the managed service, never copied from HTTP input.

History uses keyset pagination and indexed reads. Public and staff search have
different FTS indexes. Private notes do not advance a customer's visible sequence,
last activity, preview or unread state. Global support authority is not private
conversation membership; an explicit successful support claim adds membership
and fences the old ownership epoch in the same transaction.

The real-file/WAL actor suite initially passed five scenarios / 44 assertions,
including concurrent insertion, restart, replay with a new transport key,
conflicting intent, contacts/blocks, cross-scope admission, history boundaries,
author-only editing, reactions, removal, competing staff claims, and private-note
non-disclosure, plus content-free receipt recovery after membership removal.
This is not Guardian, browser, attachment, provider or deployment
qualification and does not make the unfinished API available to applications.

## Managed foundation checkpoint

Opt-in configuration, guarded SYSTEM owner receipts, per-scope file recovery,
native HTTP, request-scoped backend facade, SDK boundaries, bounded SSE and a
safe current-organization directory are implemented. Native integration and
retained-file tests pass six scenarios / 37 assertions, including strict audit
admission, accepted replay/reactions, monotonic read positions, safe retained
transaction evidence, source restart and scope-local invalidations. An additional
producer test qualifies exact transport replay after audit acknowledgments.
The managed native gate caught and helped reproduce the core FIFO async-context
bug; its repair lives in the independent blog/logging release branch as well.

Reserved typing now has a canonical membership adapter and a separate staff-note
topic; native consent scopes and a dedicated hook are present but still need
actual socket/browser qualification. The latest full root typecheck passes.
This is a committed development foundation, **not full messaging completion or
a selected stable update**. Attachment I/O, worker/Torrent/AI/provider dispatch,
customer/channel ingress, notification and final UI/deployment gates remain.

## Remaining release work

- [ ] Managed configuration, private root/realm ownership and missing-file
  recovery; source/bundle worker launch with an explicit empty environment.
- [ ] Guardian/current-authority request and machine facades, native scopes,
  transport limits, HTTP/SDK/hooks, SSE revalidation and real UI/controller wiring.
- [ ] Directory discovery and bounded contacts; receipt reconciliation without
  regranting removed membership or disclosing retained message bodies.
- [ ] Private Storage stage/upload/finalize/attach/download and orphan recovery.
- [ ] Detailed typing bound to canonical membership, not a delayed room shadow.
- [ ] Short durable job starts, independent Torrent/provider concurrency,
  current BYOK/model rules, assistant epoch fences and private-note exclusion.
- [ ] Notifications and verified Messenger ingress/outbox; unknown sends retain
  their identity and require reconciliation rather than automatic duplicate sends.
- [ ] Native workspace live history/backfill, scroll anchoring, takeover,
  keyboard/touch/reduced-motion and actual installed Linux/browser acceptance.
- [ ] Documentation, full review, normal qualified archive/update release.

## Fixed integration decisions

Use a dedicated private Fabric root. Single tenancy owns one messaging database;
multi tenancy owns a canonical database per admitted organization, enabling
independent writer concurrency and correct fixed-scope transactional audit
sources. Do not put all tenants in an application-scope audit source or project
memberships into an eventually-consistent authorization substitute. SYSTEM keeps
only owner/namespace receipts; Storage owns bytes and logging retains safe audit
metadata through its existing dedicated workers.

No long AI/provider call runs in a database automation handler or SQLite commit.
Accepted messages and their deterministic jobs commit together. Source handlers
acknowledge durable starts quickly; Torrent/work pools execute network work
independently. Check ownership before generation/publication and dispatch; an
already accepted remote request cannot be retroactively unsent.

No private message text, notes, upload capabilities, credentials, customer contact
details, prompts or responses belong in operational/audit metadata. Optional
public widget admission must mint an expiring connection-bound customer session;
the browser cannot select a tenant, external identity or staff role.
