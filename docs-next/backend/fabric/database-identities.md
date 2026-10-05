---
id: zero.fabric.identities
type: how-to
audience: [developer, agent, operator]
owner: fabric
status: draft
visibility: internal
system: fabric
feature: identities
maturity: supported
applies_to: ["2.1.1 baseline with unreleased actor environment corrections"]
modes: [single, multiple, shared-row, tenant-database, file, hot]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Opaque Database Identities

[Fabric index](./index.md) · [Documentation index](../../index.md)

## Logical Identity Is Not A Path

The public server facade exports `createDatabaseRef`,
`createNamedDatabaseRef` and `createTenantDatabaseRef`.
The named/tenant helpers domain-separate their inputs, so a tenant ID and a
named database with the same string do not intentionally select the same
managed file.

```ts
import {
  createNamedDatabaseRef,
  createTenantDatabaseRef,
} from '@zero/framework/server';

export const reportingRef = createNamedDatabaseRef('reporting');
export function tenantRefForTrustedSetup(tenantId: string) {
  return createTenantDatabaseRef(tenantId);
}
```

This is trusted configuration/correlation code, not an HTTP authorization
helper. Generic refs do not add the named/tenant binding semantics automatically.

Refs are deterministic opaque identities, not encrypted secrets or bearer
credentials. Treat them as non-secret routing metadata, but avoid exposing
internal directory/file layouts. Placement selectors receive the opaque ref;
ordinary bound data operations accept neither a ref nor a path.

## File Ownership

Fabric derives opaque filenames under its admitted private root and validates
owned file/binding identity. The root may not overlap app/system storage,
snapshots, fences, outputs or managed file-storage roots. Do not place unrelated
application assets in that root or construct file paths from user strings.

File identity and installation/source binding prevent an unrelated or mismatched
database from inheriting readiness. They are storage admission controls, not a
substitute for live Guardian membership or business resource permissions.

## Use In Placement

Compare refs from these helpers when a trusted
[placement selector](./placement.md) intentionally classifies certain databases.
Do not compare raw tenant IDs to `databaseRef` or parse its opaque representation.

For app requests, let [Guardian projection](./tenant-isolation.md) select the
database. For independent trusted planes, use the managed setup boundary rather
than exposing the raw manager as an app API.
