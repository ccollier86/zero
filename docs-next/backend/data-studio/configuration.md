---
id: zero.data-studio.configuration
type: reference
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: configuration
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

# Data Studio Installation Reference

[Data Studio index](./index.md) · [Documentation index](../../index.md)

## No Boolean Feature Switch

createDataStudioFeature has no arguments and returns the complete immutable
bundle. There is no dataStudio:true config, constructor quota map or generic
tenant selector.

Required managed profile:
auth enabled; tenancy multi; authorization advanced;
databaseTopology multiple with tenantIsolation tenant-database.

## Fragments

| Fragment | Destination |
| --- | --- |
| appTables | createApp tables, preserving public full/lazy modes |
| tables | Raw admitted actor realm tables |
| resources | Managed resource registry |
| realmContribution | composeDatabaseRealm contributions |
| clientTables | createClient tables |
| permissions | Advanced Guardian permission registry |
| roleFragments | App-selected role definitions |
| router | Normally auto-mounted; explicit standalone composition only |

Complete installation validation checks exact official schemas, policies,
field lists/loading modes and named handlers.
A matching app table name alone is not activation.

## Service And Requests

DataStudioServiceOptions requires data and actor.userId/membershipId.
The capability is already bound and must come from trusted current authorization.
No quota, raw database handle, tenantId or filesystem path parameter exists.

Mutation options require operationId on the server; browser options expose
optional operationId/signal, with stable ID retention for uncertain outcomes.
Row listing defaults/max25 and offset0; history page max10.
Limits remain exported hard constants, not app overrides.

## Read Time

Feature/realm installation is setup-time policy; current permissions/actor
authority are live per request/commit.
Browser caches retire on organization/authorization changes.

See [installation](./installation.md), [profiles](./profiles.md),
[permissions](./permissions.md), [limits](./limits.md) and [public API](./public-api.md).
