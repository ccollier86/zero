---
id: zero.data-studio.overview
type: index
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: overview
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

# Data Studio: Logical Tables In An Organization

[Backend index](../index.md) · [Documentation index](../../index.md)

Data Studio provides permission-controlled logical tables, versioned schemas and
records in the organization's Fabric database. It is long-term app data for
functions/workflows/users, not an arbitrary SQL console.

Its fixed physical backing tables store logical catalogs, rows/cells and typed
query projections. Creating a logical table does not execute caller-authored
CREATE TABLE SQL or alter Zero's system database.

## Install And Authorize

- [Installation](./installation.md): complete feature fragments and realm composition.
- [Public API](./public-api.md): browser-safe versus server-only imports.
- [Required profiles](./profiles.md): Guardian multi/advanced plus Fabric tenant files.
- [Permissions](./permissions.md): read/write/manage and ordinary app roles.
- [Configuration](./configuration.md): installation inputs and fixed limits.

## Model And Use Data

- [Tables](./tables.md): stable keys, names/status and revisions.
- [Schemas](./schemas.md): closed version1 language and compatible evolution.
- [Schema history](./schema-history.md): immutable versions, not row time travel.
- [Values](./values.md): canonical typed cells, absence/null/defaults.
- [Rows](./rows.md): complete-value replacement and optimistic revisions.
- [Queries](./queries.md): server search/filter/sort and byte-aware pages.
- [Concurrency](./concurrency.md): operation IDs and Fabric receipts.
- [Ownership](./ownership.md): user/membership attribution and minimal FK anchors.

## Integrate And Operate

- [Realtime](./realtime.md): lightweight read-only reconciliation.
- [Realm integration](./realm-integration.md): trusted local commands/queries.
- [HTTP API](./http-api.md): bounded Elysia routes.
- [Limits](./limits.md): actual format/service ceilings.
- [Errors](./errors.md): safe codes, outcomes and observations.
- [Frontend integration](./frontend-integration.md): editor/control plane and SDK.
- [Roadmap](./roadmap.md): future possibilities, not missing implemented foundations.

## Principles

Use the official bundle, live Guardian capability and tracked Fabric command
boundary. Keep logical schema/user values distinct from executable functions and
platform authority. The inspected implementation favors bounded JSON,
immutable identity, explicit revisions and private query projections.
See [Schema](../schema/index.md), [Resources](../resources/index.md),
[Fabric](../fabric/index.md) and
[frontend Data Studio](../../frontend/data-studio/index.md).
