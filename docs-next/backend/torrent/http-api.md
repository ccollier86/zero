---
id: zero.torrent.http-api
type: reference
audience: [developer, agent, operator]
owner: torrent
status: draft
visibility: internal
system: torrent
feature: http-api
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

# Authenticated Torrent HTTP API

[Torrent](./index.md) · [Authority](./authority.md) · [Documentation index](../../index.md)

The Elysia plugin mounts /workflows with Guardian readiness/auth middleware.
Use Zero's authenticated client transport. Possessing any API key does not
automatically admit these routes: Guardian credential policy/ceilings remain.

## Runs And Actions

Paths below are relative to /workflows:

| Method/path | Request and result |
| --- | --- |
| GET / | Optional status, exact name and limit (1–1,000); authorized projected instances. |
| GET /definitions | Accessible { name, steps } summaries, not graphs. |
| POST / | { name, input?, version? }; { instanceId }. |
| GET /:id | One metadata-only projected instance. |
| GET /:id/steps | Ordered projected steps. |
| GET /:id/events | Audit metadata, payload null. |
| GET /:id/topology | Immutable payload-free presentation topology. |
| GET /:id/interactions | Safe camel-case interaction records. |
| POST /:id/events | { eventName, payload? }; { ok: true, matched }. |
| POST /:id/cancel / pause / resume | State action; { ok: true }. |
| POST /:id/interactions/:interactionId/responses | { submissionId, payload, channel? }; outcome/interaction and applicable safe rejectionCode/publicMessage. |

The interaction route ends in responses, plural, not respond.
Start version is a positive integer. Private initialMemory/memoryLimits are not
HTTP start fields. Names/event names/IDs must be nonblank and satisfy bounds.

Run reads/actions require owner or current scoped management authority;
interaction responders additionally pass responder policy.
matched false can mean an event awaits eligibility durably, not lost input.
Paused/cancelled state is checked before dispatch.

Public instance/step input/output/error and event payload are null for every
format. Steps hide wait_event and item/activation keys. Intended business
results need an explicitly authorized app endpoint/private integration.

## Definition Administration

Paths below are relative to /workflows/admin/definitions; current management
authority in the selected application/tenant scope is required:

| Method/path | Operation |
| --- | --- |
| GET / | Catalog summaries. |
| GET /activities | Database-authorable activity metadata. |
| GET /:definitionId/versions | Version metadata. |
| GET /:definitionId/versions/:versionId | Editable graph/schema/access. |
| POST /publish | Graph publication. |
| PUT /drafts | New server-ID draft or exact revision update. |
| GET /drafts/:draftId | Editable draft. |
| DELETE /drafts/:draftId?expectedRevision=N | Fenced deletion; { deleted }. |
| POST /drafts/:draftId/publish | Publish expectedRevision. |
| POST /:definitionId/versions/:versionId/activate | Select for future starts. |
| POST /:definitionId/versions/:versionId/retire | Retire version. |

Publish body: name, graph, optional inputSchema/access/version/activate/
expectedActiveVersionId. Draft body: definitionId, name, graph, optional schema/
access/baseVersionId/editorMetadata. Existing draft adds draftId and
expectedRevision together. Draft publication requires expectedRevision and
accepts publication options.

Publication result: definitionId, name, activeVersionId, version, created,
activated. Version metadata: versionId, numeric version, source, format,
schemaVersion, fingerprint, status, createdAt, retiredAt.
Draft metadata: draftId, definitionId, baseVersionId, fingerprint, revision,
createdAt, updatedAt. Editable reads add graph/inputSchema/access and draft
editorMetadata.

This is scope-bound management, not global raw private-table CRUD. Database
definitions cannot install arbitrary handlers; activities must be opted in.

## Errors And Client Handling

Domain errors return { error, code } plus retryable: true when applicable.
Known status is preserved; 5xx text is generic. Validation maps to 422
WORKFLOW_REQUEST_INVALID, malformed body to 400 WORKFLOW_REQUEST_PARSE_FAILED,
missing/hidden runs to 404 WORKFLOW_NOT_FOUND, unexpected failures to 500
WORKFLOW_INTERNAL_ERROR.

Await operations and distinguish accepted starts/events from finished external
work. Retry according to code and idempotency, not every rejected promise.
Related: [definitions](./definitions.md), [events](./events.md),
[interactions](./interactions.md), [operations](./operations.md).
