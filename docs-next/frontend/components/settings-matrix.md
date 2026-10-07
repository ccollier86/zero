---
id: zero.frontend.components.settings-matrix
type: reference
audience: [developer, agent]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: settings-matrix
maturity: supported
applies_to: ["2.6.0"]
modes: [browser, SSR, controlled, Guardian-bound, standalone]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "c5656b306051b04ec6adc641b7057a0672fd7a3e"
  snapshot: clean
  date: "2026-10-07"
  evidence_level: implementation-verified
---

# Settings Matrix

[Component index](./index.md) · [Documentation index](../../index.md)

`SettingsMatrix` groups related settings into compact named rows and one to
three labeled choice columns. It is useful for notification channels, sharing
preferences or other independent boolean choices. It composes Zero's Table,
Checkbox or Switch and Tooltip rather than rebuilding those controls.

The component owns interaction state, not policy or persistence. A choice does
not create a notification-delivery rule, grant a permission or provision a
feature. The app supplies authorized values and an acknowledged save callback.
The reusable presentation and interaction contract is supported in Zero 2.6.0.

## Public Imports And Basic Example

Import `SettingsMatrix` and its types from
`@zero/framework/components/settings-matrix`, `@zero/framework/react` or
`@zero/framework`. Use Zero's normal platform styles.

This complete presentation example delegates persistence to its parent's
`save` adapter. Replace that callback with an actual authenticated SDK operation
for the application's preference service, not an invented Zero API.

```tsx
import { useState } from 'react';
import {
  SettingsMatrix,
  type SettingsMatrixChange,
  type SettingsMatrixChangeContext,
  type SettingsMatrixValue,
} from '@zero/framework/components/settings-matrix';

export function DeliverySettings({ save }: {
  save: (change: SettingsMatrixChange, context: SettingsMatrixChangeContext) => Promise<void>;
}) {
  const [value, setValue] = useState<SettingsMatrixValue>({
    mentions: { email: true, inApp: true },
    replies: { email: false, inApp: true },
  });
  return <SettingsMatrix
    title="Delivery rules"
    description="Choose where each update reaches you."
    columns={[{ id: 'email', label: 'Email' }, { id: 'inApp', label: 'In app' }]}
    rows={[
      { id: 'mentions', label: 'Direct mentions', description: 'When someone tags you in shared work.' },
      { id: 'replies', label: 'Thread replies', description: 'When someone replies to a conversation you follow.' },
    ]}
    value={value}
    onChange={async (change, context) => {
      await save(change, context);
      if (context.signal.aborted) return;
      setValue(current => ({
        ...current,
        [change.rowId]: { ...current[change.rowId], [change.columnId]: change.checked },
      }));
    }}
    help="Delivery availability is controlled by your workspace."
  />;
}
```

The parent must fence its own state/transport work after awaits. The component's
AbortSignal is advisory: aborting a browser callback does not prove the server
cancelled a write. If the service returns canonical values or a revision, adopt
that result rather than assuming the submitted value was accepted unchanged.

## Descriptors And Controlled Values

Columns require stable unique `id` and nonempty `label`. They may include an
`icon` and a tooltip `description`. There must be one, two or three columns;
ambiguous IDs or unsupported column counts produce a configuration error.

Rows require stable unique `id` and `label`, optional renderable `description`,
and optional global-to-row/per-cell restrictions. A row's `cells` map is keyed
by column ID. Values are a separate readonly map:
`value[rowId][columnId] = boolean`.

An omitted or nonboolean cell is unavailable, shown as a labeled dash. It is
not silently treated as unchecked. `false` is an actual unchecked setting.
No `onChange` callback makes all choices read-only, not pretend editable.

Each restriction level accepts `readOnly`, `disabled` and `disabledReason`.
Restrictions compose: a cell cannot override a read-only or disabled row or
matrix. Locked controls expose explanatory text via Zero's tooltip and keyboard
focusable wrapper. `disabledReason` is presentation, not server authorization.

## Asynchronous Save Lifecycle

`onChange(change, context)` receives `{ rowId, columnId, checked }` and
`{ signal: AbortSignal }`. It may complete synchronously or return a promise.
While pending, only that cell is locked and announced as saving; duplicate
activation cannot start the same operation twice. Independent cells can save
independently.

The component never mutates or optimistically replaces `value`. A resolved
callback is acknowledgment of the caller's operation; the caller updates its
controlled value from the service result. Rejection retains the supplied value
and presents safe inline retry text. Failures use
`OBS_CODES.FRONTEND_MUTATION_FAILED` with value-free surface/stage metadata,
not raw errors, row IDs, contact values or preference data.

Removing a row/column, revoking its editable capability, changing scope or
unmounting retires pending work and errors. A later rejection cannot insert an
old error into a replacement matrix. Recreating descriptor objects alone does
not cancel an operation: stable IDs and actual capabilities govern ownership.

## Provider Scope And App-Owned Targets

Inside ClientProvider/AppProvider, the component reuses Zero's authorization
boundary. Unreadable or replacing authority masks rows and disables actions;
old pending/error state is retired. It does not perform independent auth reads.
Without a provider, it remains an SSR-safe controlled component.

Use `scopeKey` additionally when the same signed-in actor changes the target
being edited—for example, an administrator selects another user's preferences,
or a page changes to another app-owned settings document. Change that key before
showing the replacement data. It is a lifecycle key, not a tenant selector or
credential. Server services must derive and authorize the actual target.

## Complete Prop Contract

| Prop | Type/default | Meaning |
| --- | --- | --- |
| `columns` | Required readonly `SettingsMatrixColumn[]` | One to three labeled choice columns. |
| `rows` | Required readonly `SettingsMatrixRow[]` | Stable settings identities and restrictions. |
| `value` | Required `SettingsMatrixValue` | Controlled boolean cells; missing cells are unavailable. |
| `onChange` | Optional callback | Receives proposed change and advisory cancellation; absence means read-only. |
| `control` | `checkbox` or `switch`, `checkbox` | Existing Zero choice primitive. |
| `title` | String, `Preferences` | Accessible section heading. |
| `description` | Optional ReactNode | Section explanation. |
| `help` | Optional ReactNode | Attached footer guidance. |
| `emptyMessage` | String, `No settings available.` | Empty-row presentation. |
| `readOnly`, `disabled`, `disabledReason` | Optional capability hints | Whole-matrix restrictions; also supported on rows and cell descriptors. |
| `scopeKey` | Optional string/number | Additional app-owned target lifetime. |
| `id`, `className` | Optional strings | Root identity/presentation composition. |

Exports include `SettingsMatrixProps`, `SettingsMatrixCapability`,
`SettingsMatrixColumn`, `SettingsMatrixRow`, `SettingsMatrixValue`,
`SettingsMatrixChange` and `SettingsMatrixChangeContext`. The internal
controller/hook are not extra public mutation APIs.

## Counts, Styling And Accessibility

The footer reports enabled choices separately from editable choices. A checked
read-only choice is still enabled but is not counted as editable. Pending state
does not erase the controlled value. Unavailable choices are neither enabled
nor editable.

The layout uses Zero's semantic Table, row/column headings, named controls,
focus/error/status semantics and platform color/font/radius/spacing tokens.
Long labels wrap within bounded columns rather than widening the page. Use
short choice headings and explanatory tooltips; the row description can carry
the longer explanation. `className` customizes the section, not its authority.

## Related Guides And Next Steps

- [Choices](./primitives/choices.md) documents the reused Checkbox/Switch controls.
- [Notifications](../notifications/index.md) distinguishes delivery services,
  inbox receipts and presentation from app-defined preferences.
- [Scope transitions](../runtime/scope-transitions.md) explains parent state fences.
- [Design tokens](../design-system/tokens.md) owns coherent theme customization.
