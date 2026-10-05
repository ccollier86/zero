---
id: zero.frontend.storage.storage-drive-settings-panel
type: reference
audience: [developer, agent, operator]
owner: storage
status: draft
visibility: internal
system: storage
feature: storage-drive-settings-panel
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

# StorageDriveSettingsPanel

[Storage UI index](./index.md) · [Documentation index](../../index.md)

`StorageDriveSettingsPanel` renders a token-aware settings form without owning transport. It edits name, byte limits, MIME list and optional durable public visibility.

| Prop | Contract/default |
| --- | --- |
| `drive` | Required StorageDriveRow. |
| `onSave` | Required `(changes: Partial<StorageDriveRow>) => void | Promise<void>`. |
| `disabled?`, `busy?` | False by default; combine with local saving state. |
| `allowPublicVisibility?` | True by default for direct legacy composition. Native Studio supplies the server policy flag. |

The form refreshes drafts when drive changes. Name is trimmed and required. Empty MIME tags serialize as wildcard '*'; tags are suggestions, not authoritative MIME validation. Byte limits must be non-negative safe whole byte counts. Malformed, negative, fractional and unsafe drafts fail validation before onSave rather than becoming unlimited. Explicit blank/zero means unlimited subject to backend policy. Save awaits onSave and keeps local saving state until completion. The parent owns transport-error presentation; it must not resolve a rejected server operation as success. The form event observes a parent-reported rejection without inventing success or emitting an unhandled browser promise.

The visibility selector is hidden when public issuance is disabled and the current drive is private. An already public drive remains visible so it can be remediated to private; enabling public is not allowed under that policy. Passing true to a UI prop never overrides server ceilings.

```tsx
import { StorageDriveSettingsPanel } from '@zero/framework/components/storage';
import type { StorageDriveRow } from '@zero/framework/components/storage';

export function Settings({ drive, save }: {
  drive: StorageDriveRow;
  save: (changes: Partial<StorageDriveRow>) => Promise<void>;
}) {
  return <StorageDriveSettingsPanel drive={drive} disabled={!drive.access?.canAdmin}
    allowPublicVisibility={false} onSave={save} />;
}
```

Use native controller slots for managed drives: expected revision and control authority belong to the native mutation layer. Partial row fields are presentation names (`max_size_bytes`, `max_file_size_bytes`, `allowed_mime_types`), not automatically the Studio request field names.

[Family index](./index.md) · [Configuration](./configuration.md) · [Native hook](./use-storage-studio-management.md) · [Backend editing](../../backend/storage/studio-editing.md)
