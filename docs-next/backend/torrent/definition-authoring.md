---
id: zero.torrent.definition-authoring
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: public-definition-authoring
maturity: preview
applies_to: ["2.6.0 with the workflow integration contracts; identify the source commit and archive hash"]
---

# Scope Bound Definition Authoring

[Torrent](./index.md) · [Definitions](./definitions.md) · [Actor starts](./actor-starts.md)

Use `zero.workflows.definitions` in an admitted server handler to manage Torrent's
existing canonical drafts and immutable versions. The facade derives its actor
and application/tenant scope from Guardian. It does not accept an actor, tenant,
database handle or caller-selected authoring source. HTTP and MCP handlers can
share this service without token self-HTTP calls or a second graph database.

## Admission And Route Ownership

The actor must currently administer workflows in this scope: platform admin in
single mode, or tenant owner/all-permissions/`workflows:manage` in multi mode.
A platform admin does not automatically administer another tenant's workflows.
Retained services revalidate their original authority on every call and at the
final writer boundary. Application-specific author/publish/caller policies remain
the host's responsibility and cannot be supplied by a request payload.

If an app owns the workflow API and its own resource admission, configure
`workflows: { http: false, register }`. This omits all generic `/workflows` routes,
including definitions, starts, events and lifecycle commands. Managed recovery,
scheduling, service injection and registered activities remain active. Default
HTTP behavior is unchanged. `WorkflowPluginConfig.http` offers the same switch
for explicit plugin composition.

Keep application pages such as `/workspace/workflows` separate from application
API routes such as `/api/pantheon/workflows`. With native HTTP enabled, GET
`/workflows` and `/workflows/:id` are JSON APIs, not pages. Do not depend on route
registration order to choose an owner.

## Drafts And Immutable Publication

```ts
import { defineEndpoint } from '@zero/framework/server';
import { expr, type WorkflowGraphIR } from '@zero/framework/workflows';

const graph: WorkflowGraphIR = {
  schemaVersion: 1, entry: 'normalize',
  metadata: { dependencies: [{ function: 'normalize-order', build: 'retained-build-1' }] },
  nodes: [{ id: 'normalize', kind: 'activity',
    activity: { name: 'orders.normalize', version: '1' },
    input: expr.object({ orderId: expr.input('orderId'), dryRun: false }),
  }], edges: [],
};

export const createDraft = defineEndpoint({
  method: 'POST', path: '/api/workflows/example-draft', auth: 'user',
  handler({ zero }) {
    if (!zero.workflows) throw new Error('Workflows are disabled');
    // Apply the app's author/resource policy before invoking this command.
    return zero.workflows.definitions.createDraft({ name: 'order-normalization', graph });
  },
});
```

Register the referenced exact activity as `databaseCallable: true` before using
the example. App-created graph data can never install executable handlers or
become trusted code-authored definitions.

`createDraft` atomically creates an unpublished catalog and first revision. It
does not create or activate an executable version. `saveDraft` accepts the
existing `definitionId`, name, graph, draft ID and `expectedRevision`. New drafts
of an existing definition omit draft ID/revision. Stale updates fail with
`WORKFLOW_DRAFT_CONFLICT`; do not silently replace a concurrent editor's content.

`publishDraft(draftId, { expectedRevision, version?, activate?,
expectedActiveVersionId? })` compiles and publishes that exact revision.
`publish({ name, graph, inputSchema?, access?, version?, activate?,
expectedActiveVersionId?, expectedFingerprint? })` publishes directly. Use
`validate(input)` to obtain the native compiler's graph/fingerprint first when
the app must review a dependency manifest. An expected fingerprint mismatch
fails rather than publishing different content. Publication deduplicates exact
content and retains immutable schema/activity pins.

`activate(definitionId, versionId, expectedActiveVersionId)` requires the exact
current active version ID, including explicit null for an inactive catalog.
`retire(definitionId, versionId)` does not rewrite already pinned runs.
`deleteDraft(draftId, expectedRevision)` applies the same optimistic fence.

These are synchronous SYSTEM-plane commands. Invoke them outside an existing
database transaction. They do not acknowledge an unrelated unfinished app or
Fabric commit. Application publication receipts must coordinate the two planes
through an explicit recoverable protocol, not pretend they share a transaction.

## Bounded Reads And Recovery

| Method | Projection and cursor |
| --- | --- |
| `list({ limit?, after? })` | Owned catalog metadata only; `after` is the last exact name. |
| `versions(definitionId, { limit?, before? })` | Immutable version metadata/fingerprints; `before` is the last version number. No graph payloads in the list. |
| `drafts(definitionId, { limit?, after? })` | Draft IDs, fingerprints, revisions and attribution; cursor is the last draft ID. |
| `getVersion(definitionId, versionId)` | Exact authorized graph/schema/access snapshot. |
| `getDraft(draftId)` | Exact owned draft, editor metadata and revision. |
| `activities()` | Trusted catalog metadata and schemas; not permission to execute every listed activity. |

Pages return `{ items, nextCursor }`, default to 40 and permit 1–100 records.
The authoring catalog lists definitions owned by this scope, not an editable
projection of another scope's code fallbacks. Exact reads reject cross-scope
IDs. Metadata paging uses bounded SQL/keyset queries.

After a lost publication acknowledgement, inspect versions/fingerprints and
recover the matching immutable identity. Do not create another definition store
or mutate private tables. First-draft creation is not an idempotent start:
reconcile its owned name/draft fingerprint after an uncertain acknowledgement.

Trusted integrations can call `WorkflowService.definitionsForActor(context,
assertCurrentAuthority?)`. The context must be captured by the normal Guardian
boundary; this is not an unauthenticated constructor. The optional final check
must be synchronous and cannot replace Guardian's checks.

## Retained Application Manifests

`WorkflowGraphIR.metadata` accepts bounded JSON for admitted dependency manifests
and editor annotations. It participates in canonicalization, the immutable
fingerprint and the pinned run snapshot. It is not evaluated or treated as
authority. Do not place credentials or private result payloads in a definition.
The host still checks the exact caller/build/account manifest before each effect.

Related: [configuration](./configuration.md), [expressions](./expressions.md),
[authority](./authority.md), [recovery](./recovery.md).
