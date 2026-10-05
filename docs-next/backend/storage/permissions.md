---
id: zero.storage.permissions
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: permissions
maturity: supported
applies_to: ["2.1.1 source; new documentation under review"]
modes: [single, multi, application, organization, personal, shared-cas]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: clean
  date: "2026-10-05"
  evidence_level: source-observed
---

# Hierarchical Storage Access

[Storage index](./index.md) · [Documentation index](../../index.md)

Storage grants read/write/admin to users, effective roles or explicitly trusted
user-property values. Grants can be drive-level or object/folder-level and are
evaluated through the hierarchy with the current server-derived context.

## Grant Shape

```ts
import type { GrantPermissionParams } from '@zero/framework/storage';
export const readerGrant: GrantPermissionParams = {
  grantType: 'role',
  grantValue: 'reader',
  permission: 'read',
};
```

This is a declaration value, not a client-authenticated write.
The permission-checked endpoint/scoped service must decide who may install it.
Property grants additionally need grantKey and a declared server-trusted property;
self-editable profile values cannot become authority.

## Authority And Ownership

A drive owner and sufficient ACL can grant effective access.
Advanced RBAC projects the actual effective role set; it is not just one stale
legacy user.role string. Tenant scope and credential ceilings still apply.

Legacy single-mode platform-admin bypass is a separate compatibility behavior.
An Administration Organization operator in multi mode is not automatically a
member/byte reader of another organization's drive.

Read does not allow upload/modify; write does not imply arbitrary ACL management.
Public access is independently read-only.

## Grant Operations And Audit

Trusted permissions API supports grant/list/get/revoke/checkAccess.
Normal HTTP/request projections rehydrate current authority and attribute ACL
changes to the canonical user/membership in Guardian audit.
A guessed permission ID cannot be revoked across the caller's scope.

Do not use raw grant/list helpers as a new public endpoint with caller-provided
role/property/owner identity. See [request authority](./request-authority.md),
[Studio permissions](./studio-permissions.md), [public access](./public-access.md)
and [errors](./errors.md).
