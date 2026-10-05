---
id: zero.data-studio.profiles
type: how-to
audience: [developer, agent]
owner: data-studio
status: draft
visibility: internal
system: data-studio
feature: profiles
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

# Required Application Profile

[Data Studio index](./index.md) · [Documentation index](../../index.md)

Data Studio currently requires all of:
Guardian auth enabled, multi tenancy, advanced authorization,
Fabric multiple topology and tenant-database isolation.

This is an explicit feature profile, not evidence that ordinary tables or
Storage Studio also require exactly that combination.

## Why The Pieces Matter

Logical tables belong to the active organization's physical database.
Current membership and tenant permissions govern operations.
Minimal local user/membership anchors allow FK attribution while canonical
Guardian state remains in the system database.

## Fail-Closed Installation

Official resource declarations are the opt-in signal.
Once any is installed, the complete table/resource/realm handler bundle and
required loading modes must match. Partial fragments fail startup with safe
DATABASE_CONFIG_INVALID details.

Matching physical table names alone do not silently activate Data Studio.
Changing an official handler/resource to a permissive app-defined version is
not a supported way to skip the feature profile.

## Organization Kind

Both administration and ordinary organization kinds can use their own tables.
The protected owner can have broad scoped app authority, but ordinary
Administration Organization members use explicitly granted app roles.
Platform operators do not automatically read another tenant's database.

There is no current single-mode or per-user isolated Data Studio profile.
A future expansion would require its own complete authority/placement design,
not a browser prop that supplies a tenant ID.

See [installation](./installation.md), [permissions](./permissions.md),
[Fabric isolation](../fabric/tenant-isolation.md) and
[Guardian](../guardian/index.md).
