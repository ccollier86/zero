---
id: zero.frontend.components.avatar-group
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: avatar-group
maturity: preview
applies_to: ["Working source on Zero 2.5.0; release qualification pending"]
modes: [browser, SSR, controlled-presentation]
reviewed_against:
  package: "@zero/framework"
  version: "2.5.0"
  commit: "43b718a5fdf6fec4acf61524ba8d490da784e747"
  snapshot: dirty
  date: "2026-10-06"
  evidence_level: source-observed
---

# Avatar Group

[Component index](./index.md) · [Documentation index](../../index.md)

`AvatarGroup` displays a compact overlapping roster, an overflow count or icon,
and an optional separate add action. It adapts REUI's avatar-group example 29
using Zero's existing Avatar, animated group, Button, icons and Tooltip. Plain
`Avatar`, `AvatarImage` and `AvatarFallback` keep their existing API.

The group is presentation, not a membership manager or presence service. It
does not fetch profiles, open a connection, send heartbeats or grant permissions.
Use it for reviewers, participants, collaborators or any authorized roster.
The current source addition is not yet a published framework update.

## Public Imports And Prerequisites

Import from `@zero/framework/components/avatar-group`, `@zero/framework/react`
or `@zero/framework`. The focused path exports `AvatarGroup`,
`AvatarPresenceIndicator` and their documented types.

Use Zero's platform stylesheet. Generated Zero apps include its component
styles; independent hosts must process `@zero/framework/styles.css` through
their normal Zero/Tailwind styling pipeline. No AppProvider or Guardian session
is required to render an already-authorized roster.

## Basic Roster And Optional Add Action

This is a complete presentation component. Its parent supplies the actual
invitation or roster-opening operation; no hypothetical SDK method is used.

```tsx
import { AvatarGroup, type AvatarGroupMember } from '@zero/framework/components/avatar-group';

const members: readonly AvatarGroupMember[] = [
  { id: 'ada', name: 'Ada Lovelace' },
  { id: 'grace', name: 'Grace Hopper' },
  { id: 'alan', name: 'Alan Turing' },
  { id: 'katherine', name: 'Katherine Johnson' },
];

export function Reviewers({ onInvite }: { onInvite?: () => void }) {
  return <AvatarGroup
    members={members}
    role="group"
    aria-label="Reviewers"
    addAction={onInvite ? { label: 'Invite reviewer', onClick: onInvite } : undefined}
  />;
}
```

By default, three avatars are visible and the fourth is represented by `+1`.
Omitting `addAction` removes the add button entirely. Use `disabled` or `pending`
on that action when the caller lacks authority or is awaiting its mutation.
The caller must still authorize any resulting server operation.

## Counts, Labels And Fallbacks

`members` must have stable unique `id` values and readable `name` labels.
An optional `src` uses the existing image/fallback lifecycle. `fallback` can
supply explicit initials or another small renderable fallback. Otherwise,
the first character of the first and last name words is used; a single word
uses one initial, and an empty name falls back to `?`.

`maxVisible` defaults to `3`; finite values are floored and clamped to zero.
A non-finite value falls back to three. `totalCount` defaults to the supplied
roster length. It can represent an authorized server total when only some
members are loaded, but is never rendered below the supplied roster length.
The remaining count is the total minus the actually visible members.

`countDisplay="number"` renders `+N`; `"icon"` renders the Plus icon with the
same accessible `N more members` label and tooltip. `onCountClick` makes that
count a real Button; without it, the count is focusable information rather
than a pretend action. No count appears when nothing remains.

## Presence Is Explicitly Opt-In

`presenceEnabled` defaults to `false`. When false, supplied presence metadata
is ignored for decoration and status labels. Ordinary neutral outlines between
overlapping avatars still appear; they are not presence rings.

Only set the prop when the app has enabled presence and its own authorized
adapter supplies current observations. A missing observation is unknown, not
offline. `AvatarPresence` is a visual mapping, not a Guardian authority record.

```tsx
import { AvatarGroup, type AvatarGroupMember } from '@zero/framework/react';

export function Participants({
  members,
  presenceEnabled,
}: {
  members: readonly AvatarGroupMember[];
  presenceEnabled: boolean;
}) {
  return <AvatarGroup
    members={members}
    shape="square"
    presenceEnabled={presenceEnabled}
    countDisplay="icon"
    role="group"
    aria-label="Participants"
  />;
}
```

A member's optional `presence` contains a readable `label`, semantic `tone`
(`success`, `warning`, `destructive`, `muted` or `primary`), optional `icon`
and optional `variant` (`ring`, `dot` or `badge`, default `ring`). For example,
an adapter can map an admitted available observation to
`{ label: 'Available', tone: 'success' }`. A stale adapter must clear or mark
its observation appropriately; the component cannot determine freshness.

Rings inherit the member's exact corner radius: circles remain circular,
rounded avatars use the configured radius, and square avatars stay square.
The accessible member/tooltip label includes the admitted status only while
presence is enabled. The separate visual indicator is `aria-hidden` to avoid
announcing it twice.

`AvatarPresenceIndicator` can also decorate another avatar composition. Its
`enabled` prop defaults false. Give its parent `position: relative`, the desired
size/radius and a complete accessible name; the indicator itself is decoration,
not a replacement for a readable status label. It consumes the same styles.

## Complete Prop Contract

| Prop | Type and default | Behavior |
| --- | --- | --- |
| `members` | Required readonly `AvatarGroupMember[]` | Authorized roster with stable identities. |
| `maxVisible` | Number, `3` | Bounded visible roster. |
| `totalCount` | Number, `members.length` | Includes unloaded members without inventing their identities. |
| `size` | `sm`, `default`, `lg`; `default` | Default metrics are 24, 32 and 40 CSS pixels. |
| `shape` | `circle`, `rounded`, `square`; `circle` | Image, fallback, count, add control and rings share the silhouette. |
| `countDisplay` | `number`, `icon`; `number` | Overflow presentation, retaining a full accessible count. |
| `onCountClick` | Optional button mouse handler | Enables the count action; caller owns its result. |
| `addAction` | Optional `AvatarGroupAddAction` | `onClick` is required; optional `label`, `disabled`, `pending`. Default label is `Add user`. |
| `presenceEnabled` | Boolean, `false` | Omits all status presentation when disabled. |
| `animated` | Boolean, `true` | Enables restrained hover lift; actual reduced-motion preference still wins. |
| Native div props | Includes `ref`, `id`, `role`, `aria-*`, `className`, `style` | Forwarded to the outer group; children are owned by `members`. |

`AvatarPresenceIndicatorProps` accepts optional `presence`, `enabled` (false),
`className` and native span props except children. The visual span remains
`aria-hidden`; it is rendered only when both enabled and an observation exists.
All related interfaces are exported from the focused path and React facade.

## Styling, Interaction And Boundaries

Colors consume Zero's `background`, `muted`, `muted-foreground`, `ring` and
semantic status tokens. Metric overrides include
`--zero-avatar-group-size-sm/default/lg`, `--zero-avatar-group-overlap`,
`--zero-avatar-group-action-gap`, `--zero-avatar-group-lift`, shape radius
variables, outline/focus variables and presence ring/badge variables. Override
them at a theme/container boundary rather than reaching into internal markup.

Keyboard focus reaches each visible member, count and enabled action. Tooltips
use Zero's viewport-aware public tooltip. Overlap containers preserve stable
member keys and raise focused members; neither image clipping nor an adjacent
avatar should hide focus/status. Reduced motion disables lift and tooltip
movement. The group introduces no separate animation or tooltip engine.

The group does not await `onClick` or manage a server operation. Supply pending
state from the owning action/controller, use the authenticated SDK where needed,
and retire roster/status data at an organization boundary. Do not pass private
names/images or an unrestricted total into a roster merely because it is small.

## Related Guides And Next Steps

- [Surfaces](./primitives/surfaces.md) covers existing plain Avatar primitives.
- [Scope transitions](../runtime/scope-transitions.md) explains retirement of
  user/organization-owned presentation data.
- [Design tokens](../design-system/tokens.md) owns shared theme configuration.
- [Component roadmap](./roadmap.md) distinguishes upcoming connected profiles
  and presence from this presentation-only component.
