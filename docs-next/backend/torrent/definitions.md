---
id: zero.torrent.definitions
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: definitions
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

# Immutable Definitions And Database Drafts

[Torrent](./index.md) · [Authoring](./authoring.md) · [Documentation index](../../index.md)

A definition publication is an immutable graph/schema/access snapshot with
exact activity versions and a content fingerprint. A catalog selects the active
version for new starts. Existing instances retain their selected version.

## Code And Database Sources

Code definitions register through WorkflowRegistry and managed startup.
Database/API definitions contain graph data, not handler functions.
registerDatabaseWorkflow/authoringSource: "database" permits only activities
explicitly registered databaseCallable. A visual editor must not bypass this
by treating untrusted input as source: "code".

Managed definitions belong to application or tenant scope. Tenant-local names
and application code fallbacks follow scope-aware selection; owner/manager
authority does not merge customer histories into a global catalog.
Publication, activation and starts use live commit-time authority and version
selection fences.

## Publication And Activation

Flow/graph publication accepts optional version and activate (default true).
Versions are positive integers; activity versions remain strings.
Graph content, schema/access and format contribute to a canonical fingerprint.
Identical content can be recognized without inventing a new executable closure;
conflicting reused versions/source/scope fail rather than overwrite history.

Retiring a version does not rewrite pinned running instances or substitute a
latest version. Before deleting/removing trusted activity code, drain old runs
or retain compatible exact versions.

## Drafts And Editor API

The authenticated management API at /workflows/admin/definitions supports
activity listing, catalogs, exact versions, publication, activation, retirement
and drafts. Draft save uses PUT /drafts:

- New draft: server owns draftId; omit expectedRevision.
- Existing draft: provide draftId and exact expectedRevision together.
- draft fields include definitionId, name, graph, inputSchema/access,
  optional baseVersionId and editorMetadata.
- Delete/publish requires the exact revision. Publication can additionally
  fence expectedActiveVersionId.

Drafts are mutable revisions; published versions are immutable. Concurrent
editors must surface WORKFLOW_DRAFT_CONFLICT instead of silently overwriting
another accepted edit. Refresh and consciously merge/retry.

Only JSON-safe graph/schema/editor metadata is accepted. Activity code remains
in the trusted catalog; do not persist arbitrary functions in graph JSON.
Executable TypeBox transforms cannot be snapshotted.

## Schemas And Public Records

normalizeWorkflowSchemaSnapshot, rehydrateWorkflowSchema and
validateWorkflowSchemaValue preserve durable schema data/TypeBox kind metadata.
Compiled definitions normalize/pin activity references before fingerprinting.
Private graph/schemas/access/receipts/memory do not appear in ordinary progress
Sync. Authorized administration reads can expose editable definitions.

No packaged n8n-style full workflow editor is promised by this API; the backend
surfaces and safe topology support an app-owned editor/monitor.
[HTTP API](./http-api.md) lists exact operations and response projections.

## Upgrade Checks

Definition publication is not a SQL database migration.
Test version pinning, active-head replacement at a start barrier, tenant scope,
databaseCallable rejection, draft races and old-run restart before deployment.
Never edit private version tables directly to migrate a running graph.

Related: [activities](./activities.md), [graph IR](./graph-ir.md),
[authority](./authority.md), [recovery](./recovery.md).
