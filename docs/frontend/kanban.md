# KanbanBoard

`KanbanBoard` is Zero's tokenized drag-and-drop Kanban organism. It is based
on the interaction pattern from the free [7ovr Kanban 1 block](https://7ovr.com/blocks/kanban),
then adapted for Zero as a generic, controlled component that can bind to
ReactiveDB or any caller-owned data source.

Use it when an app needs task boards, pipeline stages, review queues, intake
triage, workflow status lanes, or any ordered set of records grouped by a
caller-owned column field.

## Fast Path

```tsx
import { useMemo } from 'react';
import { KanbanBoard, type KanbanItemMove } from '@zero/framework/react';

interface BoardColumn {
  id: string;
  title: string;
  accent: string;
}

interface TaskCard {
  id: string;
  column_id: string;
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
}

const columns: BoardColumn[] = [
  { id: 'todo', title: 'To Do', accent: 'bg-sky-500' },
  { id: 'doing', title: 'Doing', accent: 'bg-amber-500' },
  { id: 'done', title: 'Done', accent: 'bg-emerald-500' },
];

export function ProjectBoard({ tasks }: { tasks: TaskCard[] }) {
  const orderedTasks = useMemo(
    () => [...tasks].sort((a, b) => a.title.localeCompare(b.title)),
    [tasks],
  );

  return (
    <KanbanBoard
      columns={columns}
      items={orderedTasks}
      getColumnId={(column) => column.id}
      getColumnTitle={(column) => column.title}
      getColumnAccentClassName={(column) => column.accent}
      getItemId={(task) => task.id}
      getItemColumnId={(task) => task.column_id}
      getItemTitle={(task) => task.title}
      getItemDescription={(task) => task.description}
      getItemBadge={(task) => task.priority}
      onItemClick={(task) => {
        console.log('edit card', task.id);
      }}
      onItemMove={(move: KanbanItemMove<BoardColumn, TaskCard>) => {
        console.log(move.itemId, move.toColumnId, move.toIndex);
      }}
    />
  );
}
```

Columns are caller-owned. The component is not limited to three lanes; pass any
number of columns in the order the board should render them.

## ReactiveDB Wiring

The board is controlled. It previews drag movement internally, then calls
`onItemMove` after drop. Persist the result by updating your source data.
Use `onItemClick` for card edit dialogs, detail panels, or context menus; the
component suppresses click events that are caused by drag/drop.
When opening a modal from `onItemClick`, use Zero's `modals.open` manager so
the app keeps the platform's shared portal, animation, escape handling, and
stacking behavior.

```tsx
import { useMemo } from 'react';
import { KanbanBoard, useCollection } from '@zero/framework/react';

interface BoardTask {
  id: string;
  board_id: string;
  column_id: string;
  title: string;
  sort_order: number;
}

interface BoardColumn {
  id: string;
  title: string;
  sort_order: number;
}

export function LiveBoard({
  boardId,
  columns,
}: {
  boardId: string;
  columns: BoardColumn[];
}) {
  const tasks = useCollection<BoardTask>('tasks');

  const boardTasks = useMemo(
    () =>
      tasks.data
        .filter((task) => task.board_id === boardId)
        .sort((a, b) => a.sort_order - b.sort_order),
    [boardId, tasks.data],
  );

  const orderedColumns = useMemo(
    () => [...columns].sort((a, b) => a.sort_order - b.sort_order),
    [columns],
  );

  return (
    <KanbanBoard
      columns={orderedColumns}
      items={boardTasks}
      getColumnId={(column) => column.id}
      getColumnTitle={(column) => column.title}
      getItemId={(task) => task.id}
      getItemColumnId={(task) => task.column_id}
      getItemTitle={(task) => task.title}
      onItemMove={(move) => {
        const affectedColumns = new Set([move.fromColumnId, move.toColumnId]);

        for (const columnId of affectedColumns) {
          const itemIds = move.orderedColumnItemIds[columnId] ?? [];
          for (const [index, itemId] of itemIds.entries()) {
            tasks.update(itemId, {
              column_id: columnId,
              sort_order: index,
            });
          }
        }
      }}
    />
  );
}
```

For large boards, keep board and column filters on the backend with resources
or lazy reads, then pass the visible rows as `items`. For live boards where all
visible cards should react across clients, `useCollection()` is the simplest
path.

For a complete reference app, read [LaunchBoard](./launchboard.md). It wires
`defineTable()`, `createApp()`, `AppProvider`, `useCollection()`, `AppShell`,
`KanbanBoard`, auth bootstrap routes, owner-scoped resources, and the platform
modal manager into one ReactiveDB-backed example.

## Custom Cards

Use `renderItem` when the default card is too small for the domain.

```tsx
<KanbanBoard
  columns={columns}
  items={tickets}
  getColumnId={(column) => column.id}
  getColumnTitle={(column) => column.title}
  getItemId={(ticket) => ticket.ticket_id}
  getItemColumnId={(ticket) => ticket.status}
  onItemClick={(ticket) => console.log('open ticket', ticket.ticket_id)}
  renderItem={({ item, isDragging }) => (
    <TicketCard ticket={item} dragging={isDragging} />
  )}
/>
```

The render context includes the column, column id, item, item id, and drag
state. Keep persistence in `onItemMove`; `renderItem` should only own visual
composition and local card actions.

## Source Copy

Package imports are the default:

```tsx
import { KanbanBoard } from '@zero/framework/react';
```

Use `zero add` only when an app needs to customize the component source:

```sh
zero add components/kanban
```

This copies the Kanban board, pure movement helpers, required UI primitives,
and app-owned utility files. Existing files are skipped unless `--force` is
provided.

## API Notes

| Prop | Purpose |
| --- | --- |
| `columns` / `items` | Controlled source arrays supplied by the app. |
| `getColumnId` / `getItemId` | Stable ids for drag state and React keys. |
| `getItemColumnId` | Reads which column owns each item. |
| `onItemMove` | Persist a completed move. Receives source/target columns, indexes, flat board order, and per-column ordered item ids. |
| `onItemClick` | Open a caller-owned edit dialog, detail panel, or context menu for a card. |
| `renderItem` | Fully custom card renderer. |
| `renderColumnHeader` | Fully custom lane header renderer. |
| `getItemTitle`, `getItemDescription`, `getItemBadge` | Default-card content helpers. |
| `getColumnAccentClassName` | Optional token or utility class for the lane dot. |
| `columnWidthClassName` | Width class for each lane. Defaults to a responsive 20rem lane. |

`groupKanbanItemIds()` and `projectKanbanMove()` are exported from
`@zero/framework/components/kanban` for tests and advanced custom board
implementations.
