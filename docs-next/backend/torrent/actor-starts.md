---
id: zero.torrent.actor-starts
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: actor-idempotent-starts
maturity: preview
applies_to: ["2.6.0 workflow integration contracts and SYSTEM migration 044"]
---

# Retry Safe Actor Starts

[Torrent](./index.md) · [Definition authoring](./definition-authoring.md) · [System starts](./system-starts.md)

`zero.workflows.startOnce(name, input, options)` commits a run, its original actor
seal and a permanent start receipt together. Use it when an application/Fabric
admission, HTTP gateway or MCP call can lose an acknowledgement. Ordinary `start`
and `run` retain their existing non-idempotent behavior.

## Command And Result

Options require `idempotencyKey` and optionally accept `version`, `initialMemory`,
`memoryLimits` and `binding`. The key is 1–128 portable letters/digits/periods/
underscores/colons/hyphens, starting with a letter or digit. Generate it once for
one admitted intent and retain it across retries. Do not generate a fresh key
because a response timed out.

`binding` is bounded JSON containing the app-admitted caller/delegation/dependency
manifest. It participates in the command fingerprint, not application permission.
Never copy an unvalidated client manifest into it. The first run pins the exact
selected immutable graph; explicit `version` is preferable for published editors.

An exact replay returns the original frozen acknowledgement:
`{ instanceId, name, createdAt, definitionVersion }`. Reused keys with changed
name, input, version, private memory, budgets, binding or captured authority fail
with `WORKFLOW_START_IDEMPOTENCY_CONFLICT`. JSON key ordering alone does not
change the command. Raw inputs/bindings are not copied into receipt telemetry.

Use `zero.workflows.getStartReceipt(idempotencyKey)` to reconcile without
executing work. It returns the original acknowledgement or null for this exact
actor/credential/scope. Normal `get(instanceId)` supplies admitted run details,
including exact graph/version IDs. A key alone never grants access.

## Authority And Recovery

Both first creation and replay require current Guardian authority, the same
actor/credential namespace and final synchronous app fences. The original actor
seal is retained, not rewritten from a newer role snapshot. If that original
authority has been revoked or invalidated, replay/reconciliation fails closed;
a new session is not a reason to turn the request into SYSTEM work.

Different actors, API-key credentials and tenant scopes have independent keys.
Session renewal does not mint a new receipt namespace. App-specific workflow,
caller and resource admission must also run before start or reconciliation.
Each trusted activity still rechecks the admitted resources before effects.

The receipt commits before activity dispatch. If dispatch or the HTTP response
fails afterward, the receipt remains. A matching retry drives the same run,
and restart recovery uses the persisted original actor. No raw network request
or app process must remain alive for the receipt to be valid.

Trusted server integrations use `WorkflowService.startAsActorOnce(name, input,
context, options, assertCurrentAuthority?)` and
`getActorStartReceipt(context, key, assertCurrentAuthority?)`. Request code uses
the scope-bound facade instead. These operations reject an existing outer
database transaction rather than acknowledge work that might later roll back.

## Storage And Upgrade

Managed SYSTEM migration **044** installs private actor receipt/usage tables.
Standalone workflow startup installs the identical additive schema. Application
and tenant Fabric schemas are unchanged; no auth data reset is needed. Keep
normal SYSTEM backups and use the standard package/migration deployment process.

Receipts do not expire. Deleting them or their pinned parent runs is forbidden
because forgetting a key could duplicate an external effect. The initial limit
is 100,000 receipts per actor/credential/scope, tracked in constant time. New
keys fail with non-retryable `WORKFLOW_START_LIMIT_EXCEEDED`/507 at capacity;
existing keys remain reconcilable. Compaction requires a future explicit
tombstone/retention contract, not a scheduled DELETE or unsafe key reuse.
Migration rollback refuses to remove a populated actor ledger.

Actor receipts prevent duplicate **run creation**, not exactly-once remote
effects. Provider actions still need downstream idempotency and uncertain-send
reconciliation using their stable activity identity. Later success must not
rewrite an earlier failed attempt's history.
