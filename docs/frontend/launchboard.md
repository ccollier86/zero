# LaunchBoard Reference App

`app/launchboard` is the in-repo reference app for composing Zero as a real
framework surface. It is intentionally built from platform pieces instead of
one-off local state:

- `defineTable()` in `app/launchboard/schema.ts`
- `defineResource()` plus `ownerPolicy()` in `app/launchboard/resources.ts`
- `zero.config.ts` for auth, resources, database mode, sitemap, and Doctor hints
- thin `app/server.ts` startup that imports config and calls `createApp(config)`
- `<AppProvider auth tables={tables}>` in `app/layout.tsx`
- `LoginForm`, `RegisterForm`, and `ForgotPasswordForm` routes for auth
  bootstrap testing
- `app/(launchboard)/layout.tsx` for route-owned AppShell chrome while keeping
  the app mounted at `/`
- `LaunchBoardProvider` in `app/launchboard/launchboard-context.tsx` for the
  route branch data and modal boundary
- `useCollection()` through the owner-scoped LaunchBoard data hooks
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

LaunchBoard uses four full-sync app tables. Each table includes `owner_id`,
which is hidden from table UI and enforced by resource policy:

| Table | Primary Key | Owner Column | Purpose |
| --- | --- | --- | --- |
| `launch_categories` | `category_id` | `owner_id` | Top-level sidebar workspace switcher. |
| `launch_boards` | `board_id` | `owner_id` | Boards inside the active category. |
| `launch_columns` | `column_id` | `owner_id` | Ordered Kanban lanes inside a board. |
| `launch_cards` | `card_id` | `owner_id` | Ordered cards inside a lane. |

`app/launchboard/resources.ts` registers every table with
`ownerPolicy({ userField: 'owner_id' })`. That policy:

- requires an authenticated user for reads and writes
- stamps `owner_id` on creates
- filters WebSocket snapshots and live changes to the current user
- checks update/delete ownership server-side

The client hook also filters by the signed-in user and includes `owner_id` in
optimistic rows so local UI state matches the server policy. Server policy
remains the source of truth.

LaunchBoard intentionally does not seed anonymous boards anymore. New users see
empty states and create their own category, board, columns, and cards. If a
local database was created before owner-scoped tables existed, the demo startup
resets only the four LaunchBoard tables and leaves platform/auth tables alone.
LaunchBoard also creates non-unique `owner_id` indexes on the active SQLite
database at startup and declares those fields in `zero.config.ts` under
`doctor.indexedFields`.

## Auth Behavior

LaunchBoard enables auth in `zero.config.ts` with public registration,
first-user admin bootstrap, no required email verification, and optional MFA:

```ts
export const config = defineZeroConfig({
  tables,
  resources: launchBoardResources,
  auth: {
    registration: { mode: 'public' },
    account: {
      requireEmailVerification: false,
    },
    mfa: {
      enabled: true,
      policy: 'optional',
      methods: ['email', 'totp'],
    },
  },
});
```

With Zero's default protected-first route mode, `/` requires a session while
`/login`, `/register`, `/forgot-password`, `/reset-password`, and
`/setup-password` stay public. The `/verify-email` route is present for apps
that turn on email verification, but LaunchBoard does not require verification
by default. The first account created through `/register` becomes the admin
through the platform auth bootstrap path. Later public registrations create
normal users. MFA is offered as an opt-in setup flow unless
`AUTH_MFA_POLICY=required` or `admin-required`.

## Shell Pattern

LaunchBoard keeps `app/layout.tsx` as providers only. Its app chrome lives in a
URL-less route group so the board still renders at `/`:

```txt
zero.config.ts                 # LaunchBoard runtime config
app/
  server.ts                    # imports config, createApp(config), listen
  layout.tsx                    # ThemeProvider, AppProvider, Toaster
  login/page.tsx                # LoginForm
  register/page.tsx             # RegisterForm / first admin bootstrap
  forgot-password/page.tsx      # ForgotPasswordForm
  reset-password/page.tsx       # PasswordActionForm mode="reset"
  setup-password/page.tsx       # PasswordActionForm mode="setup"
  (launchboard)/
    layout.tsx                  # LaunchBoardShell / AppShell
    page.tsx                    # /
  launchboard/
    launchboard-context.tsx     # ReactiveDB + modal actions provider
    launchboard-data-types.ts   # data contracts
    launchboard-data-utils.ts   # pure data helpers
    launchboard-shell.tsx       # AppShell workspace/nav/header config
    launchboard-page.tsx        # Kanban content only
    use-launchboard-data.ts     # data composition
    use-launchboard-mutations.ts # category/board/column commands
    use-launchboard-card-mutations.ts # card commands
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
- deleting a column deletes its cards; deleting the last column returns the
  board to the no-column empty state
- category names are unique per user to avoid accidental duplicate categories
- board duplication is allowed and clones columns plus cards
- unauthenticated users cannot mutate because the hook has no owner id

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
want to clear local auth and board state completely.

If you change framework components such as `AppShell`, restart the server so
the browser bundle is rebuilt from the current source.

Run Doctor against the root config when changing the reference app:

```sh
bun run doctor -- --config ./zero.config.ts --usage-include app
```

A healthy LaunchBoard run should have no errors or warnings. Owner-scoped
resources may still emit informational `resource.sync.row_filtered` findings;
those confirm row-filtered WebSocket sync is active.
