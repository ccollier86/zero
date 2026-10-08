---
id: zero.frontend.components.dense-list
type: reference
audience: [developer, agent]
owner: frontend-components
status: draft
visibility: internal
system: frontend-components
feature: dense-list
maturity: supported
applies_to: ["2.6.0 source; structured-modal upgrade unreleased"]
modes: [browser, SSR]
reviewed_against:
  package: "@zero/framework"
  version: "2.6.0"
  commit: "1b5a1fa0281deba69b3809471d2467d596516e4b"
  snapshot: dirty
  date: "2026-10-08"
  evidence_level: source-observed
---

# Dense Settings And Picker Lists

[Components index](./index.md) · [Documentation index](../../index.md)

DenseList supplies shared grouped rows for settings, members, connections and
compact pickers: optional leading media, title/description, trailing controls
and detail content. It owns presentation, not queries, permissions or persistence.
This is unreleased working source. Import from `@zero/framework`,
`@zero/framework/react`, or `@zero/framework/components/dense-list`.

## Settings Rows With Independent Controls

Complete component. This example keeps a local preference; a persisted setting
needs the app's awaited, authorized writer and explicit pending/error treatment.

~~~tsx
import * as React from 'react';
import { DenseList, DenseListItem, DenseListGroup, Switch } from '@zero/framework/react';

export function NotificationPreferences() {
  const [mentions, setMentions] = React.useState(true);
  return <DenseListGroup title="Notifications" description="Choose which events reach you.">
    <DenseList aria-label="Notification preferences">
      <DenseListItem title="Direct mentions"
        description="When someone tags you in a discussion."
        trailing={<Switch aria-label="Direct mentions" checked={mentions}
          onCheckedChange={setMentions} />} />
      <DenseListItem title="Weekly digest" description="A summary of recent work."
        trailing={<span>Managed by your organization</span>} />
    </DenseList>
  </DenseListGroup>;
}
~~~

DenseList renders a native ul. DenseListItem renders li, never an outer button
around a switch, select or link. Each trailing control retains its own labeling,
keyboard, disabled and pending behavior. Omitting `leading` removes that media
column rather than leaving an empty gap.

## Contract

| Component | Specific props | Meaning |
| --- | --- | --- |
| DenseList | `density: 'default' \| 'compact'` (default `default`), `separators` (default `true`) | Row density/dividers; also accepts native ul props. |
| DenseListItem | Required `title`, optional `description`, `leading`, `trailing`, `children` | React-node slots; children appear below the main row. Native li props except native title are accepted. |
| DenseListGroup | Required `title`, optional `description`, `children` | Labeled section with h3 heading; put a DenseList inside it. |
| DenseListChoice | `title`, `description?`, `leading?`, `onChoose`, `disabled?`, `children?` | Single Button-backed picker action. No trailing interactive slot; children render outside its button. |

The family is not a listbox: it does not own selection or arrow-key navigation,
and does not virtualize long lists. Use Select, Command or Cascader when those
semantics are required.

## Single-Action Picker Rows

Complete component; its owner receives selection, not a persistence receipt.

~~~tsx
import { DenseList, DenseListChoice } from '@zero/framework/react';

export function TriggerChoices({ onChoose }: { onChoose: (id: string) => void }) {
  return <DenseList aria-label="Automation trigger">
    <DenseListChoice title="Task created" description="A new task is added."
      onChoose={() => onChoose('task.created')} />
    <DenseListChoice title="Task completed" description="A task reaches Done."
      onChoose={() => onChoose('task.completed')} />
  </DenseList>;
}
~~~

Do not put a second button, link or select in a choice's leading, title or
description slots: they sit inside its action button. Use DenseListItem instead.
A modal picker can call its context's accept from onChoose; accepting a selection
does not itself write to the backend.

## Tokens And Responsive Layout

Shared list styles derive color, typography, spacing, media sizing, borders and
interaction from Zero's tokens. Trailing content wraps below the text when space
is constrained. No per-modal row markup or reference palette/font is needed.

## Related Guides And Next Steps

- [Modal layouts](../modals/layouts.md) uses these rows in tabs/navigation.
- [Settings matrix](./settings-matrix.md) covers one to three choice columns.
- [Integration settings](./integration-settings-list.md) composes caller-owned async actions.
- [Avatar group](./avatar-group.md) and [icons](../design-system/icons.md) supply leading media.
