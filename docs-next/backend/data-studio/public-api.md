---
id: zero.data-studio.public-api
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: public-api
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

# Browser-Safe And Server-Only Data Studio Imports

[Data Studio index](./index.md) · [Documentation index](../../index.md)

@zero/framework/data-studio is the shared pure foundation: logical types,
constants, codecs, domain error/HTTP projections, permission fragments and
client-safe table definitions.

@zero/framework/data-studio/server adds trusted feature/service/router/realm
composition and operation registry constants.
The managed server facade also selects these server features.

## Browser Code

Share DataStudioSchema/DataStudioValue types and codecs to build editors and
preview validation. Official Client.dataStudio transports authenticated calls
and accepts only scope-fenced results.
Pure validation does not authorize or save a row.

Do not import the server barrel/native database code into the frontend to
instantiate a service or execute a command locally.

## Server Code

DataStudioService requires an already-bound AsyncDatabaseClient plus the current
projected {userId,membershipId}. It accepts no tenantId/file path and has no
constructor quota overrides.
Normal routes construct it from the verified request/service boundary.

Raw realm handlers and internal command input are trusted infrastructure;
passing a fabricated actor object is not authentication.
For verified machine principals use the supported live
[server authority projection](../runtime/machine-services.md).

## Definitions And Runtime Metadata

appTables preserves official full/lazy client intent alongside server schema;
tables is the raw realm map; clientTables is lightweight browser reconciliation.
They are different fragments, not interchangeable copies.

See [installation](./installation.md), [ownership](./ownership.md),
[realm integration](./realm-integration.md), [realtime](./realtime.md)
and [frontend integration](./frontend-integration.md).
