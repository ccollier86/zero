---
id: zero.frontend.components.integration-settings-list
type: reference
audience: [developer, agent]
owner: frontend-components
status: verified
visibility: internal
system: frontend-components
feature: integration-settings-list
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

# Integration Settings List

[Component index](./index.md) · [Documentation index](../../index.md)

`IntegrationSettingsList` displays app connections as a compact flat list or
named groups. Rows combine a service identity, description, labeled status
and contextual actions. It reuses Zero's buttons, menus, confirmation dialog,
icons and semantic tokens.

The same presentation can serve a user's connections, an organization's
integrations or platform settings. The owning adapter supplies authorized
items and actions. The list does not create OAuth routes, store credentials,
infer connectivity or decide server permissions. It is supported in Zero 2.6.0
and separate from the [connected profile-settings surface](../guardian/profile-settings.md):
neither component invents an app's integration-management backend.

## Public Imports And Basic Example

Import from `@zero/framework/components/integration-settings-list`,
`@zero/framework/react` or `@zero/framework`. Use Zero's normal platform styles.
An AppProvider is not required for standalone controlled presentation.

This complete presentation example delegates its actual operations to the
parent. It does not assume a nonexistent Zero connection-management API.

```tsx
import { IntegrationSettingsList } from '@zero/framework/components/integration-settings-list';

export function Connections({ reconnect, remove, create }: {
  reconnect: (signal: AbortSignal) => Promise<void>;
  remove: (signal: AbortSignal) => Promise<void>;
  create: (signal: AbortSignal) => Promise<void>;
}) {
  return <IntegrationSettingsList
    title="App connections"
    description="Manage services used by this workspace."
    primaryAction={{ onSelect: ({ signal }) => create(signal) }}
    groups={[{
      id: 'communication',
      title: 'Communication',
      description: 'Channels and updates for shared work.',
      items: [{
        id: 'team-chat',
        title: 'Team chat',
        description: 'Route alerts and approvals to shared channels.',
        status: { label: 'Connected', tone: 'success' },
        actions: [
          { id: 'reconnect', label: 'Reconnect', onSelect: ({ signal }) => reconnect(signal) },
          { id: 'remove', label: 'Remove connection', destructive: true,
            onSelect: ({ signal }) => remove(signal) },
        ],
      }],
    }]}
  />;
}
```

Remove uses a confirmation dialog before dispatch. After a successful operation,
the owning adapter updates the controlled items/status or invalidates its query.
The component does not remove a row or claim a new status on its own.

## Flat And Grouped Data

Supply exactly one data shape:

- `items`: a readonly array for one flat list, without extra nested group cards.
- `groups`: a readonly array of named/unnamed groups, each with its own items.

Group IDs must be nonempty and unique. Item IDs must be unique within their
group; action IDs must be unique within their item. Flat rows do not manufacture
a user, organization or platform identity. In callbacks their `groupId` is null.

`IntegrationSettingsItem` contains required `id` and `title`, optional
`description`, `icon`, `logo: { src, alt? }`, `status`, `actions`, `disabled`,
`disabledReason` and `revision`. Change `revision` when the same item ID refers
to a replacement action target. Recreating object instances alone is not
replacement; the actual ID/revision/capabilities control pending work.

`IntegrationSettingsGroup` contains required `id` and `items`, optional
`title`, `description` and `emptyMessage`. Group empty text overrides the list's
empty text. Assets and descriptions are caller-owned; do not expose private
contacts or secrets through a logo URL, tooltip or row label.

## Status And Actions

`status` contains a readable `label` and optional `tone`: `success`, `warning`,
`destructive`, `muted` or `info`. Tone selects a semantic token, not a hardcoded
provider palette. The text label carries meaning without relying on color.
If the service is unready or disconnected, its adapter supplies that real state;
absence of status does not mean connected.

Each action requires `id`, `label` and
`onSelect(context): void | Promise<void>`. The context contains the current
`item`, `groupId` and advisory `signal`. Optional fields are `icon`,
`destructive`, `disabled`, `disabledReason` and `confirmation`.

A nonempty `disabledReason` disables dispatch even if `disabled` is omitted,
and the menu exposes the explanation. Item restrictions also block its actions.
Do not use a disabled-looking icon to represent an action that remains callable.
Server authorization remains mandatory.

`readOnly` on the list retains rows and statuses while locking every mutation,
including the header action. `readOnlyReason` provides a section explanation;
the default is `Read-only connections`. This is a presentation restriction,
not a replacement for server-enforced access. Switching that mode retires old
pending actions and confirmations.

Destructive actions always require the existing AlertDialog confirmation.
`confirmation` can override its `title`, renderable `description` and
`confirmLabel`; it can also request confirmation for a nondestructive action.
Changing data, scope or capability while a dialog is open invalidates its old
intent rather than authorizing a replacement target with the prior confirmation.

Each actionable row retains a visible menu button for touch and keyboard use.
`contextMenu={true}` additionally enables the public ContextMenu for right-click
and keyboard context-menu access; it does not replace the visible button.

## Pending, Failure And Scope Retirement

One row can run only one action at a time. Admission locks synchronously to
prevent duplicate clicks, shows a pending state and keeps other rows usable.
The optional header action has its own single-flight lifetime. Controlled data
remains unchanged until the owner adopts its acknowledged service result.

Failures show safe inline retry copy and use
`OBS_CODES.FRONTEND_MUTATION_FAILED` with surface/stage metadata. Zero does not
emit provider identifiers, item IDs, rejected response bodies or arbitrary
exception detail from these actions. Optional
`onActionError(error, context)` lets an app handle a domain failure; it receives
the original cause only while the owning scope is current. Its context is
`{ itemId, groupId, actionId }`, with null fields for the primary action.
The app remains responsible for any additional display/logging it chooses.

Inside ClientProvider/AppProvider, the list uses Zero's existing authorization
boundary: replacing or unreadable authority masks rows and retires pending
actions, dialogs and errors. For another target selected under the same actor,
change `operationScopeKey` before supplying replacement data. Item `revision`
provides an additional row-level target fence.

Callbacks must respect `signal` and fence their own state after awaits. Browser
cancellation is advisory, not proof that a server-side operation was cancelled
or rolled back. Reuse the authenticated SDK and server services for persistence;
a visual action's existence must not widen authority.

## Complete Root Prop Contract

| Prop | Type/default | Meaning |
| --- | --- | --- |
| `items` or `groups` | Required exclusive data choice | Flat list or grouped list; never both. |
| `title` | Optional string | Section heading. |
| `description` | Optional ReactNode | Supporting section copy. |
| `primaryAction` | Optional `IntegrationSettingsPrimaryAction` | Separate header action; omitted means no New Connection button. |
| `emptyMessage` | Optional ReactNode; `No connections yet.` | Empty-list/group fallback. |
| `operationScopeKey` | Optional string/number | Retires work for an app-owned target replacement. |
| `contextMenu` | Boolean, `false` | Adds right-click/keyboard context access. |
| `readOnly` | Boolean, `false` | Retains data while locking row/header mutations. |
| `readOnlyReason` | String, `Read-only connections` | Explanation when the list is read-only. |
| `onActionError` | Optional callback | Current-scope domain failure notification, not default raw-error presentation. |
| Native section attributes | Includes id/aria/class/style | Presentation composition; children and title are owned by this contract. |

`IntegrationSettingsPrimaryAction` requires `onSelect({ signal })`, with
optional `label` (default `New Connection`), `icon`, `disabled` and
`disabledReason`. Omitted icon uses the Plus icon; `null` omits it.

All public item/group/action/status/confirmation/context/props types are
exported from the focused path and React facade. Internal action sessions and
lookup helpers are not provider-management APIs.

## Layout And Interaction

The root heading and primary action form a compact header. Named groups use
thin borders and row separators; flat mode avoids unnecessary nested cards.
Rows keep identity on the leading side, status and actions on the trailing side.
At narrow widths those areas wrap deliberately rather than clipping controls.
Menus and dialogs retain Zero's keyboard, focus and viewport behavior.

Component CSS variables control density, row/icon/action metrics and typography;
colors/radii/focus reuse the current Zero theme. This component does not perform
the future global Linear-inspired theme redesign or introduce its own palette.
For example, set `--integration-settings-unit`, `--integration-settings-gap`,
`--integration-settings-padding`, `--integration-settings-logo-size`,
`--integration-settings-radius`, `--integration-settings-text-size` or
`--integration-settings-detail-size` on a theme/container. Public metric values
are inherited rather than shadowed by component-local defaults.

## Related Guides And Next Steps

- [Dropdown menus](./overlays/dropdown-menu.md) explains reused menu composition.
- [Context Menu](./overlays/context-menu.md) documents optional contextual access.
- [Modals](../modals/index.md) explains confirmation and lifecycle ownership.
- [Scope transitions](../runtime/scope-transitions.md) covers parent state retirement.
- [Settings matrix](./settings-matrix.md) provides complementary compact preferences.
