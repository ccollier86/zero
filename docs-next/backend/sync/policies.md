---
id: zero.sync.policies
type: reference
audience: [developer, agent, operator]
owner: sync
status: draft
visibility: internal
system: sync
feature: policies
maturity: supported
applies_to: ["2.1.1 source baseline; package qualification pending"]
modes: [single, multi, default-plane, system-plane, tenant-database]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Compose Sync Policies

[Sync index](./index.md) · [Documentation index](../../index.md)

SyncPolicy provides synchronous table read, general mutation and
insert/update/delete callbacks. A decision is boolean or {ok, reason}.
Callback failures normalize to denial rather than permission.

```ts
import {
  combineSyncPolicies, createDefaultSyncPolicy,
} from '@zero/framework/sync';
import type { SyncPolicy } from '@zero/framework/sync';

const appPolicy: SyncPolicy = {
  canDelete: ({ authContext }) => Boolean(authContext?.userId),
};
export const policy = combineSyncPolicies(
  createDefaultSyncPolicy({ writeProtectedTables: ['audit_entries'] }),
  appPolicy,
);
```

This example is an additional restriction, not a complete production resource
policy. Requiring any user ID does not establish ownership or RBAC.

## Managed Versus Standalone

Standalone missing callbacks allow access. Managed createApp composes platform
protections and Resource policy with app restrictions. combineSyncPolicies uses
deny-wins composition: another policy cannot reopen a table denied earlier.

A table can be readable while direct WebSocket writes are prohibited. Framework
control-plane tables use their service/HTTP actions for writes; exposing a
read-only reconciliation stream does not expose their private mutations.

## Row And Field Access

Registered Resource policy supplies realm binding, action admission, row filters
and field projections. Multi-tenant app tables require explicit realm/exposure
classification. A tenant ID sent by a client is not authority.

Current row policy is rechecked for delivery and mutation. Changed read authority
requires a new connection baseline rather than continuing with an old filter.
Keep reasons bounded and free of sensitive values; app policy code remains
trusted server code.

See [resource policies](../resources/policies.md),
[field access](../resources/field-access.md), [Guardian authorization](../guardian/index.md),
[tenant Sync](./tenant-sync.md) and [configuration](./configuration.md).
