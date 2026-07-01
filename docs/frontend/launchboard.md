# LaunchBoard Reference App

`app/launchboard` is the in-repo reference app for composing Zero as a real
framework surface. It is intentionally built from platform pieces instead of
one-off local state:

- `defineTable()` in `app/launchboard/schema.ts`
- `createApp({ tables })` and server-side seeding in `app/server.ts`
- `<AppProvider tables={tables}>` in `app/layout.tsx`
- `app/(launchboard)/layout.tsx` for route-owned AppShell chrome while keeping
  the app mounted at `/`
- `LaunchBoardProvider` in `app/launchboard/launchboard-context.tsx` for the
  route branch data and modal boundary
- `useCollection()` in `app/launchboard/use-launchboard-data.ts`
- `AppShell` for the category switcher, board navigation, breadcrumbs, and
  sidebar action menus
- `KanbanBoard` for controlled drag/drop
- `FormField`, `FormLabel`, `FormControl`, `Input`, `Textarea`, and Radix-backed
  `Select` for modal forms
- `modals.open()` and `modals.confirm()` for create, edit, duplicate, and
  delete workflows

Use this app as the first reference before building a dashboard, work queue,
pipeline, CRM, project tracker, intake triage screen, or any app where records
move between ordered columns.

## Data Model

LaunchBoard uses four full-sync app tables:

| Table | Primary Key | Purpose |
| --- | --- | --- |
| `launch_categories` | `category_id` | Top-level sidebar workspace switcher. |
| `launch_boards` | `board_id` | Boards inside the active category. |
| `launch_columns` | `column_id` | Ordered Kanban lanes inside a board. |
| `launch_cards` | `card_id` | Ordered cards inside a lane. |

The seed runs on the server through `ReactiveDB.insert()` and only runs when
`launch_categories` is empty. Runtime changes happen through browser
collections and sync back over Zero's WebSocket path.

## Shell Pattern

LaunchBoard keeps `app/layout.tsx` as providers only. Its app chrome lives in a
URL-less route group so the board still renders at `/`:

```txt
app/
  layout.tsx                    # ThemeProvider, AppProvider, Toaster
  (launchboard)/
    layout.tsx                  # LaunchBoardShell / AppShell
    page.tsx                    # /
  launchboard/
    launchboard-context.tsx     # ReactiveDB + modal actions provider
    launchboard-shell.tsx       # AppShell workspace/nav/header config
    launchboard-page.tsx        # Kanban content only
```

Categories map to `AppShell workspaces`. Boards map to a sidebar nav group. The
active board exposes nested column rows with per-column counts, while
board-specific edit, duplicate, and delete controls use AppShell nav item
`actions`.

```tsx
<AppShell
  brand={{ name: 'LaunchBoard', subtitle: 'Zero ReactiveDB', icon: 'clipboard' }}
  workspaces={{
    label: 'Categories',
    activeId: activeCategoryId,
    createLabel: 'Add category',
    items: categories.map((category) => ({
      id: category.category_id,
      name: category.name,
      subtitle: `${boardCounts[category.category_id] ?? 0} boards`,
      icon: 'layers',
    })),
    activeActions: [
      { label: 'Edit category', icon: 'settings', onSelect: editCategory },
      { type: 'separator' },
      { label: 'Delete category', icon: 'trash', destructive: true, onSelect: deleteCategory },
    ],
    onCreate: createCategory,
    onSelect: (category) => selectCategory(category.id),
  }}
  nav={[
    {
      label: 'Boards',
      items: boards.map((board) => ({
        label: board.name,
        icon: 'clipboard',
        active: board.board_id === activeBoardId,
        onSelect: () => selectBoard(board.board_id),
        actions: [
          { label: 'Edit board', icon: 'settings', onSelect: () => editBoard(board) },
          { label: 'Duplicate board', icon: 'copy', onSelect: () => duplicateBoard(board) },
          { type: 'separator' },
          { label: 'Delete board', icon: 'trash', destructive: true, onSelect: () => deleteBoard(board) },
        ],
      })),
    },
  ]}
/>
```

Do not hand-roll an app shell for this class of app. Configure `AppShell`
first, then drop down to sidebar primitives only if the shell contract cannot
express the product. Keep shell/navigation code in a layout-owned component and
keep route pages focused on the actual app surface.

## ReactiveDB Mutation Pattern

`KanbanBoard` is controlled. It previews movement during drag, then emits the
full ordered item IDs for each column. Persist by updating the relevant rows:

```tsx
<KanbanBoard
  columns={activeColumns}
  items={activeCards}
  getColumnId={(column) => column.column_id}
  getColumnTitle={(column) => column.title}
  getItemId={(card) => card.card_id}
  getItemColumnId={(card) => card.column_id}
  onItemMove={(move) => {
    for (const [columnId, cardIds] of Object.entries(move.orderedColumnItemIds)) {
      cardIds.forEach((cardId, index) => {
        cards.update(cardId, { column_id: columnId, sort_order: index });
      });
    }
  }}
/>
```

The reference hook also owns relationship cleanup:

- deleting a category deletes its boards, columns, and cards
- deleting a board deletes its columns and cards
- deleting a column deletes its cards and keeps at least one column
- category names are unique to avoid accidental duplicate categories
- board duplication is allowed and clones columns plus cards

## Modal Pattern

LaunchBoard uses `modals.open()` for forms and `modals.confirm()` for
destructive actions. Keep this pattern in app work so overlays share Zero's
portal, animation, focus handling, escape handling, and stacking behavior.
The manager renders the close control with Zero's animated icon trigger, so app
forms do not need to supply their own close button.

Modal form bodies should still use Zero form and input primitives. Use
`FormField`, `FormLabel`, and `FormControl` for custom modal layouts; use
`AutoForm` only when the schema-driven generated layout is enough. Use Zero's
Radix-backed `Select` instead of native `<select>` so enum, status, color, and
relationship fields can render icons, swatches, keyboard behavior, portal
menus, and tokenized styling.

```tsx
let modalId = '';
modalId = modals.open({
  title: 'Add board',
  content: (
    <BoardForm
      onCancel={() => modals.close(modalId)}
      onSubmit={(input) => {
        createBoard(categoryId, input);
        modals.close(modalId);
      }}
    />
  ),
});
```

## Running It

From the repository root:

```sh
PORT=3000 bun app/server.ts
```

LaunchBoard uses Zero's hot SQLite runtime by default:

- `DB_MODE=hot`
- `DB_PATH=./data/launchboard.db`
- `DB_SNAPSHOT_PATH=./data/launchboard.snapshot.db`

The active database runs in memory while the app is live. `createApp()` writes
periodic and shutdown snapshots, then restores from the snapshot on the next
start. Set `DB_MODE=file` to use direct SQLite/WAL mode, or `DB_MODE=ephemeral`
for throwaway testing. Delete the LaunchBoard files under `./data` when you
want the deterministic seed to run again from a blank database.

If you change framework components such as `AppShell`, restart the server so
the browser bundle is rebuilt from the current source.
