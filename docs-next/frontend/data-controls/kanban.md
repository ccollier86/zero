---
id: zero.frontend.data-controls.kanban
type: reference
audience: [developer, agent]
owner: frontend-data-controls
status: draft
visibility: internal
system: frontend-data-controls
feature: kanban
maturity: supported
applies_to: ["2.1.1 source with audited corrections; package qualification pending"]
modes: [browser, SSR, single-database, Fabric]
reviewed_against:
  package: "@zero/framework"
  version: "2.1.1"
  commit: "a3a5f726768dac890f241a3899c0a1acb66265d9"
  snapshot: dirty
  date: "2026-10-05"
  evidence_level: source-observed
---

# Controlled Kanban Boards

[Data controls index](./index.md) · [Documentation index](../../index.md)

KanbanBoard is a generic tokenized pointer/keyboard drag-and-drop view.
It projects a move and calls app code; it does not own a collection, server write
or accepted mutation runner. Use a source of ordered items plus an app writer
that persists column/rank changes under normal permissions.

## Minimal Controlled Example

```tsx
import { KanbanBoard } from '@zero/framework/components/kanban';

<KanbanBoard
  columns={columns}
  items={items}
  getColumnId={(column) => column.id}
  getColumnTitle={(column) => column.title}
  getItemId={(item) => item.id}
  getItemColumnId={(item) => item.columnId}
  getItemTitle={(item) => item.title}
  onItemMove={persistMove}
/>;
```

This fragment assumes string IDs and app-owned arrays/persistMove.
onItemMove is a void notification, not an awaited writer. It must arrange source
updates and handle asynchronous persistence/rejection explicitly; do not assume
table-style pending/acceptance behavior. The board re-renders from supplied items.

## Move Contract

KanbanItemMove<TColumn,TItem> includes item/itemId, fromColumn/fromColumnId,
toColumn/toColumnId, fromIndex/toIndex, orderedItemIds and orderedColumnItemIds.
Use that projection to persist meaningful rank/order fields, not only visual
array changes. Stable unique IDs and declared destination columns are required.

groupKanbanItemIds(columnIds, itemIds, itemColumnIds) preserves caller ordering
within declared columns; items in unknown columns are not included.
projectKanbanMove({ columnIds, itemIds, itemColumnIds, activeId, target }) returns
a projection or null for invalid/no-op movement. target is
{ type: 'column'|'item', id }. The result contains ordered itemIds, itemColumnIds,
columnItemIds, source/destination IDs and indices. Both helpers are pure and
perform no persistence or authorization.

## Rendering And Interaction Options

Required props are columns, items and the four ID/title accessors.
Optional onItemClick receives item plus rendering context.
renderItem/context and renderItemActions/context customize cards and independent
controls. Context is { column, columnId, item, itemId, isDragging, isOverlay }.
Render item actions beside the keyboard drag activator, not nested inside it.
renderColumnHeader receives { column, columnId, itemCount }.

getColumnAccentClassName/getColumnClassName/getItemClassName customize tokens/classes.
getItemTitle/getItemDescription/getItemBadge/getItemBadgeVariant and assignee
name/avatar/fallback accessors feed the default card. emptyColumnText defaults
"Drop here". dragEnabled defaults true; false disables sensors without dimming
readable content. disabled defaults false and disables all board interactions/
adds unavailable styling. className/boardClassName customize containers;
columnWidthClassName defaults 'w-[min(20rem,82vw)]'.

KanbanTaskCard is also public. Required title plus optional description, badge,
badgeVariant, assigneeName/Avatar/Fallback, dragging, dimmed and className control
presentation; it is not an independent persistence component.

## Scope And Failure Ownership

Keep records tenant/permission scoped through the normal SDK/resource source.
UI drag admission is not a server permission. Apps that require accepted movement
can compose a mutation runner, pending source state and rollback/refetch feedback.
Because Kanban's callback is intentionally synchronous, it does not automatically
wait, deduplicate/retry writes or resolve external outcomes.

On scope change provide the new admitted arrays and invalidate any app-owned
pending movement. Server writes still need live authority and idempotency where
appropriate. Do not persist untrusted column/item IDs without validation.

## Verification

Exercise pointer and keyboard moves, same/different/empty columns, invalid/no-op
targets, independent action buttons, dragEnabled=false, disabled=true, rejected
app writes and source replacement. Pure projection/render tests establish their
focused behavior; app writer and production browser qualification are separate.

## Related Guides And Next Steps

- [Actions](./data-table/actions.md) offers a scope-aware app operation runner.
- [SDK collections](../sdk/collections.md) supplies normal reactive sources.
- [DataTable](./data-table/index.md) is the query/pagination alternative.
- [Roadmap](./roadmap.md) distinguishes future data control improvements.
