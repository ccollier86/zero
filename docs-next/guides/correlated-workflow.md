---
id: zero.guides.correlated-workflow
type: how-to
audience: [developer, agent, operator]
owner: zero-documentation
status: draft
visibility: internal
system: cross-system
feature: correlated-workflow-replies
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [multi-advanced, Fabric-tenant-database, file]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Resume One Workflow From Its Verified Reply

[Guides index](./index.md) · [Documentation index](../index.md)

Use this pattern when a server workflow requests an external action—an SMS
reply, for example—and a later authenticated webhook updates its business
record. Each request stores one exact Torrent `instanceId`. An organization
with three waiting requests must not wake all three when only one reply arrives.
This sample models one external request per instance. For multiple questions
inside one run, use a distinct per-question correlation and the
[interaction contract](../backend/torrent/interactions.md); do not reuse one
record or assume identically named parallel waits identify the intended answer.

The examples below are complete server modules, not a complete application or
an SMS authenticator. They compose existing Guardian, Fabric, ReactiveDB
automations and Torrent APIs. The provider adapter remains application code.

## Prerequisites And Authority

Start with the [organization application](./organization-app.md): enabled
multi-tenant Guardian, advanced RBAC, a provisioned owner/membership, and a
file-backed Fabric tenant-database topology with the same-entry actor branch.
The organization realm and `AppConfig.tables` must contain identical application
tables. Torrent must be enabled; its runs and inbox live in the system database,
not in the business realm. Read [Torrent configuration](../backend/torrent/configuration.md)
and [automation configuration](../backend/database-automations/configuration.md)
before adding these contributions.

Declare tenant-scoped permissions `replies:request` and `replies:receive` in
Guardian. Grant `replies:request` to a declared `reply-operator` app role.
The independently verified webhook principal needs `replies:receive` in its
server-bound organization; a normal browser user need not receive that power.
An Administration Organization app-only or mixed-role member can use this
feature in that organization's own file when granted the app role. Platform
administration does not select a customer's file implicitly.

| Boundary | Authority |
| --- | --- |
| Start and activity execution | Current actor, declared app permission and sealed Torrent authority |
| External request adapter | Trusted server code; revalidated immediately before delivery |
| Reply endpoint | Independently authenticated provider credential, server-owned organization binding and live fences |
| Durable trigger function | Trusted source-bound system execution; exact recorded target only |

The private record's workflow ID is a correlation, not a foreign key into
Torrent's separate system database and not a bearer credential. Never expose
an endpoint that accepts an arbitrary organization, workflow ID and reply and
then forwards them with system authority.

## 1. Declare The Private Record And Durable Bridge

Complete module: `server/db/replies.ts`. It is safe to import while constructing
the realm: declarations do not start a server or call a provider.

```ts
import {
  defineDatabaseRealmContribution,
  type DatabaseAutomationExecutionServerServices,
} from '@zero/framework/server';
import { customPolicy, defineResource } from '@zero/framework/resources';
import {
  defineDatabaseAutomations, defineDatabaseFunction, defineDatabaseTrigger,
  type DatabaseTriggerFunctionInput,
} from '@zero/framework/database-automations';

export const replyTables = {
  reply_requests: {
    request_id: 'text primary key',
    workflow_instance_id: 'text not null',
    status: 'text not null',
    provider_message_id: 'text',
    reply: 'text',
  },
};

export const replyResource = defineResource({
  table: 'reply_requests', realm: 'tenant', exposure: 'internal',
  policy: customPolicy(() => false),
});

const resumeReply = defineDatabaseFunction<
  DatabaseTriggerFunctionInput, void, DatabaseAutomationExecutionServerServices
>({
  name: 'replies.resume-run', version: 1, mode: 'durable',
  async handler({ input, zero, signal }) {
    signal.throwIfAborted();
    const row = input.change.row;
    if (!row || row.status !== 'received'
      || input.change.previousRow?.status !== 'pending'
      || row.request_id !== input.change.rowId
      || row.workflow_instance_id !== input.change.rowId) return;
    await zero.torrent.deliverEvent(input.change.rowId, 'reply', {
      replyRecordId: input.change.rowId,
    });
  },
});

export const replyAutomations = defineDatabaseAutomations({
  functions: [resumeReply],
  triggers: [defineDatabaseTrigger({
    name: 'replies.received', version: 1, table: 'reply_requests',
    after: { update: { columns: ['status'] } }, run: resumeReply,
  })],
});

export const replyContribution = defineDatabaseRealmContribution({
  name: 'correlated-replies', version: '1',
  tables: replyTables, automations: replyAutomations,
});
```

Register `replyResource` in `AppConfig.resources`, and compose
`replyContribution` into the actor's shared realm using
[realm composition](../backend/fabric/realm-composition.md). Use the composed
realm's tables in `AppConfig.tables`; keep any other existing resources and
contributions. Do not additionally install these functions into the pinned
`databaseAutomations` registry: that is a different physical source.

`exposure: 'internal'` blocks generated HTTP and Sync access to the correlation
table. It does not prevent trusted server operations. A browser must not be
able to replace `workflow_instance_id` or mark a fabricated reply received.
The update-column filter identifies relevant changes; the handler's snapshot
checks enforce the actual `pending` → `received` transition.

## 2. Register Activities And A Matching Wait

Complete module: `server/workflows/reply.ts`. Supply an app-owned transport at
managed startup. It must resolve `destinationRef` within the supplied authority,
honor the stable external idempotency key, use the signal when supported, and
revalidate immediately before sending. It must not log the destination or reply.
Normalize provider failures to safe app error codes/messages before rejecting;
do not put raw provider response bodies or credentials into persisted workflow
errors.

```ts
import { t } from 'elysia';
import type {
  AppWorkflowsConfig, AuthorityScopedServerServices,
} from '@zero/framework/server';
import {
  WorkflowError, flow, step, waitFor, expr, type StepContext,
} from '@zero/framework/workflows';

type RequestInput = { destinationRef: string };
export type ReplyTransport = (input: {
  requestId: string;
  destinationRef: string;
  idempotencyKey: string;
  signal: AbortSignal;
  zero: AuthorityScopedServerServices;
  assertCurrentAuthority: () => void;
}) => Promise<void>;

function actor(ctx: StepContext<unknown, AuthorityScopedServerServices>) {
  ctx.assertCurrentAuthority();
  if (ctx.execution.kind !== 'actor' || !ctx.zero?.data
    || !ctx.signal || !ctx.idempotencyKey) {
    throw new WorkflowError('Reply workflow requires a live tenant actor',
      'WORKFLOW_AUTHORITY_REQUIRED', 403);
  }
  ctx.zero.access.requirePermission('replies:request');
  ctx.signal.throwIfAborted();
  return { zero: ctx.zero, data: ctx.zero.data,
    signal: ctx.signal, key: ctx.idempotencyKey };
}

export function replyWorkflows(send: ReplyTransport): AppWorkflowsConfig {
  return {
    register(registry) {
      registry.registerActivity<unknown, AuthorityScopedServerServices>({
        name: 'replies.prepare', version: '1', databaseCallable: false,
        async handler(ctx) {
          const { data, signal, key } = actor(ctx);
          await data.mutate({
            type: 'create', table: 'reply_requests', row: {
              request_id: ctx.instanceId, workflow_instance_id: ctx.instanceId,
              status: 'pending', provider_message_id: null, reply: null,
            },
          }, { idempotencyKey: key, signal });
          return { requestId: ctx.instanceId };
        },
      });
      registry.registerActivity<RequestInput, AuthorityScopedServerServices>({
        name: 'replies.send', version: '1', databaseCallable: false,
        inputSchema: t.Object({ destinationRef: t.String({ minLength: 1, maxLength: 128 }) }),
        async handler(ctx) {
          const { zero, signal, key } = actor(ctx);
          ctx.assertCurrentAuthority();
          await send({ requestId: ctx.instanceId,
            destinationRef: ctx.input.destinationRef, idempotencyKey: key,
            signal, zero, assertCurrentAuthority: ctx.assertCurrentAuthority });
          return { requested: true };
        },
      });
      registry.registerActivity<{ replyRecordId: string }, AuthorityScopedServerServices>({
        name: 'replies.finish', version: '1', databaseCallable: false,
        inputSchema: t.Object({ replyRecordId: t.String({ minLength: 1 }) }),
        async handler(ctx) {
          const { data, signal } = actor(ctx);
          if (ctx.input.replyRecordId !== ctx.instanceId) {
            throw new WorkflowError('Reply correlation does not match this run',
              'WORKFLOW_INPUT_INVALID', 422);
          }
          const { value } = await data.get('reply_requests', ctx.instanceId,
            { consistency: { mode: 'strong' }, signal });
          if (value?.status !== 'received') {
            throw new WorkflowError('Reply record is not received',
              'WORKFLOW_STATE_INVALID', 409);
          }
          // Use value.reply in a trusted domain operation if needed;
          // do not copy sensitive reply content into Sync-visible step output.
          return { received: true, requestId: ctx.instanceId };
        },
      });
      registry.registerWorkflow({
        name: 'request-reply', version: 1,
        inputSchema: t.Object({ destinationRef: t.String({ minLength: 1, maxLength: 128 }) }),
        access: { start: ['reply-operator'], inspect: ['reply-operator'] },
        flow: flow(
          step('prepare', { name: 'replies.prepare', version: '1' }),
          step('send', { name: 'replies.send', version: '1' }, { input: expr.input() }),
          waitFor('reply', 'reply', { timeoutMs: 300_000,
            inputSchema: t.Object({ replyRecordId: t.String({ minLength: 1 }) }) }),
          step('finish', { name: 'replies.finish', version: '1' },
            { input: expr.output('reply') }),
        ),
      });
    },
  };
}
```

Install `workflows: replyWorkflows(yourTrustedTransport)` in the existing app
configuration. This extends managed registration; preserve other activities
when composing with an existing registration callback. The example's
`databaseCallable: false` deliberately limits these activities to code-authored
flows. Set it true only after reviewing their inputs and capabilities for
database/editor authors, not merely to make a registry error disappear.

Start through an authorized scoped `zero.workflows.start('request-reply',
{ destinationRef })` or the official workflow HTTP/client action. Its result
is the exact instance ID, not a completed run. The provider request carries the
same `requestId` supplied by the activity; the webhook echoes that correlation.
The transport must not choose a different workflow target.

The prepared record commits **before** the external request is sent. Its create
uses the logical step's stable receipt key: retry replays the accepted create
instead of replacing an already-received record with `pending`. The provider
send likewise needs remote idempotency. Neither local receipts nor activity
success can undo an SMS that the provider already accepted.

## 3. Commit A Verified Reply Atomically

Complete module: `server/services/receive-reply.ts`. Call it only after the
app's provider authenticator has validated the signature/credential, replay
policy, request format and server-owned organization mapping. Construct its
strict `zero` argument through the verified
[machine-service projection](../backend/runtime/machine-services.md), with both
mandatory live fences. A value typed `VerifiedReply` is not proof of verification.

```ts
import {
  DatabaseError, type AuthorityScopedServerServices,
} from '@zero/framework/server';

export type VerifiedReply = {
  requestId: string;
  providerMessageId: string;
  text: string;
};

export async function receiveVerifiedReply(
  zero: AuthorityScopedServerServices, reply: VerifiedReply,
) {
  zero.access.requirePermission('replies:receive');
  const data = zero.data;
  if (!data) throw new DatabaseError('DATABASE_OPERATION_UNSUPPORTED',
    'Reply reception requires the bound tenant database');
  if (!reply.requestId || reply.requestId.length > 128
    || !reply.providerMessageId || reply.providerMessageId.length > 128
    || new TextEncoder().encode(reply.text).byteLength > 4_096) {
    throw new DatabaseError('DATABASE_PAYLOAD_INVALID', 'Reply input is invalid');
  }
  const { value: row } = await data.get('reply_requests', reply.requestId,
    { consistency: { mode: 'strong' } });
  if (!row || row.request_id !== reply.requestId
    || row.workflow_instance_id !== reply.requestId) {
    throw new DatabaseError('DATABASE_CONFLICT', 'Reply target is unavailable',
      { retryable: false });
  }
  if (row.status === 'received'
    && row.provider_message_id === reply.providerMessageId && row.reply === reply.text) {
    return { status: 'already-received' as const };
  }
  if (row.status !== 'pending') {
    throw new DatabaseError('DATABASE_CONFLICT', 'Reply transition is not allowed',
      { retryable: false });
  }
  const key = 'reply:' + new Bun.CryptoHasher('sha256')
    .update(JSON.stringify([reply.requestId, reply.providerMessageId])).digest('hex');
  await data.batch({
    assertions: [{ type: 'row-equals', table: 'reply_requests',
      id: reply.requestId, row }],
    mutations: [{ type: 'update', table: 'reply_requests', id: reply.requestId,
      patch: { status: 'received', provider_message_id: reply.providerMessageId,
        reply: reply.text } }],
  }, { idempotencyKey: key });
  return { status: 'received' as const };
}
```

The same-file assertion and update are one writer transaction, unlike a
read/check followed by an unconditional update. Two different replies racing
for the pending record cannot both replace it. A same-key concurrent duplicate
with identical command content can replay the existing durable receipt.
A later identical delivery returns `already-received`; a different reply for
a received record is rejected. Treat an assertion conflict as a reason to
reread/reconcile, not as permission to overwrite the winner.

The thin Elysia webhook route should call the authenticator and this service,
then map its safe outcome/error. It is deliberately not shown as an anonymous
route with a fabricated Guardian user. Provider signature algorithms, nonce
retention, credential rotation and retry acknowledgement vary by provider;
they belong to that adapter. Do not pass raw keys into Torrent input/memory.

## 4. Observe The Matched Delivery

The accepted update and immutable durable outbox command commit together in
the tenant file. The dispatcher later calls the source-bound bridge. It sends
event **`reply`** to the recorded **instance ID**, matching
`waitFor('reply', 'reply', ...)`. The payload contains only `replyRecordId`, not
the reply body. The durable helper derives its permanent event receipt from
the outbox delivery, so replaying that delivery does not append another event.

Torrent's inbox retains an early reply even if the workflow has not reached
its wait yet. Paused workflows do not execute because a reply arrived; they
need an authorized resume. A cancelled/terminal run cannot be revived by a
reply. An accepted business update therefore does not prove workflow completion.
Monitor durable delivery outcomes separately from run state.

This is two durable databases connected by an idempotent bridge, **not** a
cross-database transaction. If the webhook commits and the process stops before
event delivery, pending automation recovery retries the stored command. If an
event commits but the durable action cannot record success, its retry reuses
the event receipt. A response with `DATABASE_OUTCOME_UNKNOWN` needs the same
stable command/receipt reconciliation; do not issue a new key blindly.

Run/step progress can be rendered with the official
[Torrent hooks](../frontend/torrent/hooks.md) and
[public topology](../frontend/torrent/visualization.md). The private reply
record is not hydrated into a browser collection. Build a separately authorized,
field-limited public status resource if your product needs one.

## Verification And Troubleshooting

Before connecting a real provider, use a disposable synthetic app and an
idempotent fake transport. Verify these outcomes:

1. Three started instances create three private records before delivery.
2. A reply to the second record wakes only the second instance; first and third
   remain waiting. Changing organization cannot select their records.
3. Duplicate and concurrently duplicated provider messages create one transition
   and one durable event; competing distinct replies have one accepted winner.
4. A reply arriving during the send activity is retained for the later wait.
5. Pause, role/key revocation, timeout, cancellation and shutdown/restart preserve
   their distinct authority/lifecycle outcomes rather than bypassing them.
6. A failure after business commit recovers delivery, and a failure after event
   commit replays the receipt instead of creating another event.
7. Managed HTTP/Sync cannot read or edit the internal correlation table, and
   safe diagnostics contain neither reply text nor provider secrets.

An event-name mismatch leaves a wait pending; compare the exact `reply` string
at both ends. Missing Torrent, lost live authority, nonexistent targets, or
source/target scope disagreement fail closed. Do not repair those by exposing
`unsafe` services or replacing scope with a webhook body tenant ID. Use
[automation operations](../backend/database-automations/operations.md),
[Torrent operations](../backend/torrent/operations.md) and
[Fabric error outcomes](../backend/fabric/operations-diagnostics.md) to distinguish retryable
pre-dispatch failures from unknown committed outcomes.

## Related Guides And Next Steps

- [Targeted database-to-Torrent delivery](../backend/database-automations/torrent.md)
  owns the exact helper and receipt contract.
- [Torrent events](../backend/torrent/events.md) explains early inputs, bounds,
  redaction and ordinary versus idempotent system delivery.
- [Interactions](../backend/torrent/interactions.md) is the alternative when
  responder policy, explicit questions and response rejection are required.
- [Fabric operations](../backend/fabric/operations.md) owns atomic batches,
  consistency, receipts and cancellation after dispatch.
- [Machine services](../backend/runtime/machine-services.md) owns the verified
  external-principal projection and live-fence requirements.
