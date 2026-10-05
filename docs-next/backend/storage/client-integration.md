---
id: zero.storage.client
type: how-to
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: client
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

# Official SDK And Reactive Storage UI

[Storage index](./index.md) · [Documentation index](../../index.md)

The browser Client exposes storageStudio for authenticated management.
It uses Zero's centralized auth restoration/refresh and scope-fenced response
handling, not an app adapter manually appending a cached token.

## Provisioning

```ts
import type { Client } from '@zero/framework';

export function provisionWorkflowDrive(client: Client, operationId: string) {
  return client.storageStudio.provisionDrive({
    owner: 'organization',
    key: 'workflow-files',
    name: 'Workflow files',
  }, { operationId });
}
```

The SDK separates mutation options (operationId/signal) from the request body.
Preserve operationId for unknown-outcome retries; inspect the receipt/value and
current profile instead of assuming every returned drive is instantly ready.

## Management Surface

getCapabilities/listDrives/getDrive/getDriveByKey/listDriveJobs provide the safe
catalog. updateDrive and changeDriveLifecycle use current expectedRevision.
The Studio page contract is limit/count/hasMore/nextCursor, not a fabricated
expensive exact total.

Scope replacement invalidates pending response acceptance.
Safe mutation errors retain operation identity/outcome for appropriate recovery;
do not leak a stale successful organization response into the new screen.

## Reactive Metadata And Components

STORAGE_TABLES supplies client-safe lazy drive/object definitions.
Spread it into createClient tables along with app tables; do not register private
ACL/job/publication system sidecars as browser tables.
Managed transport policy still filters admitted metadata.

StorageManagement/StorageFileBrowser and storage/upload hooks compose existing
table/list-detail/action-bar/design tokens.
A UI may be admin-only, organization-managed or personal according to server
capability and app placement; components do not install permission grants.

See [frontend SDK](../../frontend/sdk/index.md),
[Studio installation](./studio-installation.md), [editing](./studio-editing.md),
[downloads](./downloads.md), [errors](./errors.md) and
[request authority](./request-authority.md).
