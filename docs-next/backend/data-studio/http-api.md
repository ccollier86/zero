---
id: zero.data-studio.http-api
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: http-api
maturity: supported
applies_to: ["2.1.1 baseline with unreleased datetime calendar correction"]
modes: [multi, advanced-RBAC, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Bounded Data Studio HTTP API

[Data Studio index](./index.md) · [Documentation index](../../index.md)

The managed router is /api/_zero/data-studio, using Zero defineRouter/
defineEndpoint and current scoped services.

## Routes

| Method/path under prefix | Purpose |
| --- | --- |
| GET /capabilities | Current tenant permission/limit read model |
| GET /tables | Catalog, optional status |
| GET /tables/:tableId | Full table/schema |
| POST /tables | Create logical table (manage) |
| PATCH /tables/:tableId | Edit metadata/schema (manage) |
| POST /tables/:tableId/status | Active/archive transition (manage) |
| GET /tables/:tableId/rows | Bounded searched/filtered/sorted page (read) |
| GET /tables/:tableId/rows/:rowId | Row (read) |
| POST /tables/:tableId/rows | Create row (write) |
| PUT /tables/:tableId/rows/:rowId | Full replacement (write) |
| DELETE /tables/:tableId/rows/:rowId | Delete row (write) |
| GET /tables/:tableId/schema-versions | Paged schema history (read) |

Mutation bodies include operationId; edits/deletes include current
expectedRevision where required. Use the official SDK to encode request/query
shapes and preserve operation IDs instead of duplicating transport logic.

## Query Names

Row HTTP filter is a bounded JSON-encoded query field that maps to the typed
public filters array; the SDK handles its encoding.
search/limit/offset/sortColumnId/sortDirection are validated, including explicit
maximums and closed additional properties.

## Authority And Failure

Current organization kind can be administration or organization.
Live tenant permission/session/API-key ceilings are checked; no arbitrary
tenant selector is accepted by the service.
Malformed inputs/errors use safe domain projection, not raw SQLite/path/value
diagnostics.

The official complete feature is mounted automatically; standalone router
composition needs equivalent data/profile/authority prerequisites.
See [installation](./installation.md), [permissions](./permissions.md),
[queries](./queries.md), [errors](./errors.md) and [concurrency](./concurrency.md).
