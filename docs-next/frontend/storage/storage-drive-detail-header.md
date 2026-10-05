---
id: zero.frontend.storage.storage-drive-detail-header
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-drive-detail-header
maturity: supported
applies_to: ["2.1.1 development source; not package-qualified"]
modes: [single-tenant, multi-tenant, guardian-enabled, storage-enabled]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# StorageDriveDetailHeader

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageDriveDetailHeader({ drive, className? })` presents one `StorageDriveRow`: name, public/private, effective access/owner badges, allowed MIME text, logical usage and file/folder counts.

It loads usage with `useDriveUsage(drive.id)`; the parent supplies the row, not a raw server service. Used bytes/counts default to zero while unresolved; maximum falls back to the row's max_size_bytes. The displayed percentage caps at 100 and appears only with a positive limit. A nonpositive configured limit is displayed as unlimited, not as a missing tenant grant.

```tsx
import { StorageDriveDetailHeader } from '@zero/framework/components/storage';
import type { StorageDriveRow } from '@zero/framework/components/storage';

export function DriveSummary({ drive }: { drive: StorageDriveRow }) {
  return <StorageDriveDetailHeader drive={drive} />;
}
```

This component is presentation, not an access gate. A public badge indicates durable visibility; it does not imply write/admin permission. An Owner badge comes from effective backend capabilities, not name/email matching.

Use [native inspector](./storage-studio-inspector.md) when needing profile revision, lifecycle and managed owner scope. A legacy row does not contain those sidecar fields.

[Family index](./index.md) · [Drive detail](./storage-drive-detail.md) · [Usage/quota hooks](./storage-browser-hooks.md) · [Backend quotas](../../backend/storage/studio-quotas.md)
