---
id: zero.concepts.data-planes
type: architecture
audience: [developer, agent, operator]
owner: platform-runtime
status: draft
visibility: internal
system: platform-runtime
feature: data-planes
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Data Planes: What Lives Where

[Concepts index](./index.md) · [Documentation index](../index.md)

Zero separates platform authority from application records. “Single database”
describes the application's data topology; it does not mean Guardian and every
platform table are mixed into the application database.

| Plane | Owns | Who selects it |
| --- | --- | --- |
| System database | canonical identities/authority and managed platform records, including Torrent runtime state and storage metadata | managed server composition |
| Pinned application database | the application's non-tenant-isolated tables | app configuration and admitted server services |
| Fabric tenant databases | the tables contributed to a tenant's admitted realm | server-derived live tenant authority and realm routing |

The system database is physically separate in managed composition, including a
single-topology application. Reusing the same file for both planes or keeping
legacy full platform tables in application data is not a supported shortcut.
Upgrading package code is distinct from migrating a legacy database layout.

## Choose Topology Separately From Authentication

Guardian controls identity, tenancy and permissions. ReactiveDB controls tracked
SQLite changes. Fabric coordinates multiple physical databases. Their modes
interact, but are not synonyms:

- One application data file can serve a single-tenant application.
- Multi-tenant authority can scope records using the declared resource policy.
- Fabric tenant-database isolation chooses a physical database from trusted
  tenant scope, instead of treating a client-provided path as authority.
- Loading a database into RAM is a persistence/placement decision, not a tenant
  permission decision.

Do not infer physical isolation from a tenant_id column, or infer access merely
because a record is in the actor's selected file. Resource policy and live
Guardian authority still govern operations inside that database.

## References Across Planes

SQLite foreign keys cannot refer across independently opened databases.
[Guardian reference fields](../backend/schema/guardian-references.md) request
minimal local user/membership anchors. Canonical login, profile, account status,
roles and revocation remain in the system plane.

An anchor is not a permission cache. It lets the application maintain referential
integrity while authorization remains live. Developers needing the full identity
record use supported Guardian/server services, not a join against an assumed
full users table in the application database.

## Storage, KV And Vector Are Separate Boundaries

Storage metadata and file bytes have different owners. A drive is a logical
authority boundary; default shared content-addressed storage is not a promise
of one physical disk for each organization. Access policy must still govern
file upload, listing, preview, download and capability links.

KV is a dedicated memory-first service with its own selected journal/checkpoint
durability; it is not an application SQL table or distributed lock service.
Vector indexes are local index storage with their own data directory and scope
filter contract; metadata filters alone do not authenticate a caller.

Do not place every store in the same directory or open a live data path merely
to test a documentation example. Configuration admission and operations guides
must preserve each store's ownership, durability and backup requirements.

## Lifecycle And Testing

Managed startup admits configuration and schemas before publishing data
capabilities. Guardian anchor readiness and Fabric provisioning/migration are
part of that boundary, not work for an untrusted browser to perform.
Shutdown drains dependent extension work while its providers remain available,
then releases owned services.

A useful test covers both placement and authority: create records in two
tenant databases, prove each authorized actor sees only its admitted results,
then revoke a grant and verify cached credentials no longer authorize access.
Counting database files alone is not an end-to-end isolation test.

## Related Guides And Next Steps

- [Service boundaries](./service-boundaries.md) explains why raw handles and
  scoped request services are different capabilities.
- [Reactivity](./reactivity.md) traces committed changes across those boundaries.
- [Schema tables](../backend/schema/tables.md) declares application data without
  implicitly placing it or granting access.
