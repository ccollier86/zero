# AppShell

[Frontend index](./README.md) · [Master/detail layouts](./master-detail.md) · [Data Studio](../data-studio.md)

`AppShell` is Zero's app-ready layout surface for dashboards, admin tools,
internal apps, CRUD products, and data-driven workspaces. The default preset
uses Zero's packaged Animate UI/Radix sidebar with an integrated inset header
row like the Animate UI sidebar example: sidebar trigger, light separator,
optional breadcrumbs, and content below with `p-4 pt-0`.

Use `AppShell` before hand-rolling a sidebar/header layout. Drop down to the
sidebar primitives only when the shell config cannot express the design.

## Where AppShell Belongs

`AppShell` is route chrome, not the global app provider layer. Put it in the
layout branch that should look like an application dashboard:

```txt
app/
  layout.tsx                    # ThemeProvider, AppProvider, Toaster
  (public)/layout.tsx           # public flow shell, no AppShell
  (public)/page.tsx             # /
  (dashboard)/layout.tsx        # AppShell + config.auth
  (dashboard)/dashboard/page.tsx # /dashboard
```

Do not put `AppShell` in `app/layout.tsx` unless every route should inherit the
dashboard shell, including login, public intake, marketing, and token-resume
flows. For public-first apps, use `createApp({ auth: true, routeAuth:
'explicit' })` and export `config.auth` from the dashboard layout.

Route groups can also mount a dashboard shell at the root URL without moving
AppShell into the root provider layout:

```txt
app/
  layout.tsx                    # providers only
  (launchboard)/
    layout.tsx                  # AppShell
    page.tsx                    # /
```

That is the LaunchBoard pattern: `app/(launchboard)/layout.tsx` owns the shell
and `app/launchboard/launchboard-page.tsx` owns only the board content.

## Default Dashboard Shell

```tsx
import { AppShell, type AppShellNavGroup } from '@zero/framework/react';

const nav: AppShellNavGroup[] = [
  {
    label: 'Platform',
    items: [
      {
        label: 'Boards',
        href: '/boards',
        icon: 'layers',
        defaultOpen: true,
        children: [
          { label: 'Active', href: '/boards/active' },
          { label: 'Archived', href: '/boards/archived' },
        ],
      },
      { label: 'Docs', href: '/docs', icon: 'clipboard' },
      { label: 'Settings', href: '/settings', icon: 'settings' },
    ],
  },
];

export function RootShell({ children }: { children: React.ReactNode }) {
  return (
    <AppShell
      brand={{ name: 'Zero App', subtitle: 'Workspace', icon: 'layers' }}
      nav={nav}
      breadcrumbs={[
        { label: 'Boards', href: '/boards' },
        { label: 'Active' },
      ]}
      user={{
        name: 'Casey',
        email: 'casey@example.com',
        fallback: 'CA',
        accountHref: '/account',
        notificationsHref: '/notifications',
      }}
    >
      {children}
    </AppShell>
  );
}
```

`breadcrumbs` are optional. If the app does not need breadcrumbs, use the same
header row for a title, custom content, or actions:

```tsx
import { Button } from '@zero/framework/react';

<AppShell
  brand={{ name: 'LaunchBoard' }}
  nav={nav}
  header={{
    title: 'LaunchBoard',
    subtitle: '2 categories / 4 boards / 18 cards',
    actions: <Button>New card</Button>,
    themeToggle: true,
  }}
>
  <BoardWorkspace />
</AppShell>
```

Hide the row for full-screen tools:

```tsx
<AppShell header={false} nav={nav}>
  <CanvasEditor />
</AppShell>
```

## Presets

| Preset | Use When |
|--------|----------|
| `dashboard` | Default. Collapsible sidebar, inset header row, content area. |
| `auth-dashboard` | Same layout, intended for auth-backed apps with user menu data. |
| `simple-sidebar` | Focused tools with an app-owned sidebar, similar to LaunchBoard. |
| `topbar` | Public flows or apps that need a top row without a sidebar. |
| `minimal` | Login, reset password, public token flows, embedded tools. |
| `custom` | Use the dashboard provider/inset but supply your own sidebar content. |

## Content Height And Scrolling

`contentMode` selects the shell's content-height contract:

| Mode | Behavior | Preset default |
| --- | --- | --- |
| `workspace` | A viewport-bounded, shrinkable flex content area. Inner workspaces own scrolling rather than stretching the page. | `dashboard`, `auth-dashboard`, `simple-sidebar`, `custom` |
| `document` | Natural-height document flow for long pages and forms. | `topbar`, `minimal` |

```tsx
<AppShell contentMode="workspace" nav={nav}>
  <DataStudio />
</AppShell>
```

Data Studio and the [master/detail components](./master-detail.md#bounded-workspace-composition)
fill that available height, scroll the panes independently and keep bottom
actions anchored. Intermediate app wrappers should use
`flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden`; page headings outside
the workspace should be `shrink-0`. A wide inner grid scrolls inside its own
region rather than widening the shell.

For a long settings or document page under a dashboard preset, explicitly
choose document mode:

```tsx
<AppShell contentMode="document" nav={nav}>
  <SettingsPage />
</AppShell>
```

Alternatively, retain workspace chrome and give the document a bounded
scrolling child (`className="min-h-0 flex-1 overflow-auto"`). After upgrading,
make this choice for pages that previously depended on dashboard content growing
without a height constraint. The shell's header and navigation configuration
remain unchanged; `contentClassName` still styles its inner content wrapper.

## Workspace Switcher

Pass `workspaces` to render the top sidebar dropdown from the Animate UI
example. It supports active workspace display, selectable workspaces, shortcuts,
an optional create action, and optional actions for the active workspace.

```tsx
<AppShell
  brand={{ name: 'Acme Inc' }}
  workspaces={{
    label: 'Teams',
    activeId: activeTeamId,
    createLabel: 'Add team',
    items: [
      { id: 'acme', name: 'Acme Inc', subtitle: 'Enterprise', icon: 'layers' },
      { id: 'studio', name: 'Studio', subtitle: 'Startup', icon: 'terminal' },
    ],
    onSelect: (team) => setActiveTeamId(team.id),
    onCreate: openCreateTeam,
    activeActions: [
      { label: 'Edit team', icon: 'settings', onSelect: openEditTeam },
      { type: 'separator' },
      { label: 'Delete team', icon: 'trash', destructive: true, onSelect: deleteTeam },
    ],
  }}
  nav={nav}
>
  {children}
</AppShell>
```

Use `activeActions` when the current workspace/category/team needs edit,
delete, export, or archive controls. Use nav item `actions` for item-specific
menus lower in the sidebar.

For a Zero multi-tenant auth scope, do not map `useAuth()` data into this
generic list or switch a local `activeId`. Use the packaged adapter:

```tsx
import { AppShell, useTenantAppShellWorkspaces } from '@zero/framework/react';

function AuthenticatedShell({ children }: { children: React.ReactNode }) {
  const workspaces = useTenantAppShellWorkspaces({
    // Optional: expose the same tenant-creation route from the menu.
    onCreate: () => { window.location.href = '/organizations/new'; },
  });

  return <AppShell workspaces={workspaces}>{children}</AppShell>;
}
```

The adapter requires an exact server-committed active tenant; AppShell will not
mask a missing/mismatched selection by showing the first membership. It uses
the same session-rotation and authorization-scope barrier as
`<TenantSwitcher>`, retains the committed label while pending, exposes load or
switch errors with a retry action, announces completion, and restores focus to
the workspace trigger. A normal app-owned `workspaces` object keeps the legacy
first-item fallback unless it explicitly sets `requireActiveSelection: true`.

`useTenantAppShellWorkspaces(options)` accepts:

| Option | Behavior |
|--------|----------|
| `onSwitched(tenantId)` | Runs after the server-committed tenant becomes active. |
| `hideWhenSingle` | Hides a completed one-membership switcher by default; create and active actions keep it visible. |
| `label` | Overrides the terminology-derived menu heading. |
| `createLabel` | Overrides the terminology-derived create label. |
| `onCreate()` | Adds an app-owned tenant creation action. |
| `activeActions` | Adds standard `AppShellMenuItem` actions for the active tenant. |
| `itemSubtitle(tenant)` | Maps safe tenant summary data to each item's subtitle. |

The hook owns only tenant selection state. Creation and active actions remain
app callbacks and are frozen with all other workspace mutations while a tenant
session replacement is pending.

For category-driven apps, use the workspace switcher for categories and the
main nav group for the active category's boards:

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
      items: boardsForActiveCategory.map((board) => ({
        label: board.name,
        icon: 'clipboard',
        active: board.board_id === activeBoardId,
        onSelect: () => selectBoard(board.board_id),
      })),
    },
  ]}
/>
```

## Nested Navigation

Nav groups map to sidebar groups. Items with `children` become animated
collapsible menu sections. Use `defaultOpen` or `active` to open a section
initially; `currentPath` lets the shell infer active items from URLs. Icons in
AppShell sidebar buttons and dropdown menu rows use Zero's animated icon
trigger behavior by default.

```tsx
<AppShell
  currentPath={pathname}
  nav={[
    {
      label: 'Platform',
      items: [
        {
          label: 'Playground',
          href: '/playground',
          icon: 'terminal',
          children: [
            { label: 'History', href: '/playground/history' },
            { label: 'Starred', href: '/playground/starred', badge: 4 },
            { label: 'Settings', href: '/playground/settings' },
          ],
        },
      ],
    },
  ]}
/>
```

Use child `badge` values for per-section counts such as cards in a Kanban
column. Keep parent badges for parent-level state only; avoid duplicating the
same count at both levels.

### Collapsed Sidebar Tooltips

The default shell automatically uses each navigation item's `label` as its
collapsed-desktop tooltip and accessible label. Override the hint with that
item's `tooltip` string when a more descriptive label is useful:

```tsx
{
  label: 'Runs',
  tooltip: 'Workflow runs',
  href: '/runs',
  icon: 'layers',
}
```

The navigation control's accessible name remains its `label`; the `tooltip`
override changes the hover hint, not the control's name.

The brand, active workspace and account buttons also receive labels from their
configured names. Workspace hints follow the committed displayed workspace;
they do not represent an optimistic tenant switch or replace pending/error
announcements.

Hints appear on pointer hover only while the desktop sidebar is collapsed.
Keyboard focus alone does not open them. Clicking a sidebar control dismisses
its hint and keeps it closed until the pointer leaves and hovers again; the
control's accessible label remains available. They reuse Zero's public Radix
tooltip, which portals its content,
adjusts placement at viewport edges and wraps long labels. Disabling decorative
sidebar hover highlighting does not disable the hints. No separate tooltip
provider or application configuration is needed. See [Sidebar](./sidebar.md#collapsed-navigation-labels)
for positioning overrides and accessible custom-content composition.

Use `variant: 'action'` for sidebar action rows such as "Add board" or "Add
project". The action variant keeps the row in the AppShell navigation contract
while styling it as a create button instead of another navigation target:

```tsx
{
  id: 'add-board',
  label: 'Add board',
  icon: 'plus',
  variant: 'action',
  onSelect: openCreateBoard,
}
```

## Theme Toggle

Use `header.themeToggle` to render Zero's packaged Animate UI
`ThemeTogglerButton` in the integrated header row. The shell default is a
two-state light/dark control. In supporting browsers, the next theme expands
in a circular View Transition from the button that was clicked while one SVG
rotates and reshapes between its sun and moon states. Keyboard activation uses
the button center, unsupported browsers change theme without the page reveal,
and reduced-motion preferences skip the decorative animation.

```tsx
<AppShell
  brand={{ name: 'Zero App' }}
  nav={nav}
  header={{
    title: 'Dashboard',
    themeToggle: true,
  }}
>
  <Dashboard />
</AppShell>
```

Pass a config object when the app wants to include `system` in the cycle or set
the fallback reveal origin used by custom/primitive callers that do not provide
a click position:

```tsx
<AppShell
  nav={nav}
  header={{
    themeToggle: {
      modes: ['light', 'dark', 'system'],
      direction: 'rtl',
      variant: 'ghost',
      size: 'default',
    },
  }}
>
  <Dashboard />
</AppShell>
```

Keep `ThemeProvider` in the root layout. `AppShell` renders the button; it does
not own theme persistence.

## Item Action Menus

Add `actions` to a nav item to render the three-dot hover action menu. This is
the Zero surface for the "project actions" pattern in the Animate UI example.

```tsx
{
  label: 'Design Engineering',
  href: '/projects/design',
  icon: 'layers',
  actions: [
    { label: 'View project', icon: 'eye', href: '/projects/design' },
    { label: 'Duplicate', icon: 'copy', onSelect: duplicateProject },
    { type: 'separator' },
    { label: 'Delete', icon: 'trash', destructive: true, onSelect: deleteProject },
  ],
}
```

## User Menu

Pass `user` for the footer user button. If `userMenu` is omitted, Zero builds a
small default menu from `accountHref`, `notificationsHref`, and `onLogout`.

```tsx
<AppShell
  user={{
    name: user.name,
    email: user.email,
    avatar: user.avatarUrl,
    accountHref: '/account',
    notificationsHref: '/notifications',
    onLogout: logout,
  }}
  userMenu={[
    { label: 'Account', icon: 'user', href: '/account' },
    { label: 'Notifications', icon: 'bell', href: '/notifications' },
    { type: 'separator' },
    { label: 'Log out', icon: 'log-out', onSelect: logout },
  ]}
/>
```

## Custom Sidebar

Use `preset="custom"` when the app needs the dashboard provider/header/content
layout but owns the sidebar body. Zero still wraps this content in
`Sidebar collapsible="icon"` and adds the rail, so the slot should contain
sidebar regions like `SidebarHeader`, `SidebarContent`, and `SidebarFooter`,
not a second `Sidebar` root.

```tsx
import {
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
} from '@zero/framework/components/sidebar';

<AppShell
  preset="custom"
  sidebar={
    <>
      <SidebarHeader>{/* app-specific switcher */}</SidebarHeader>
      <SidebarContent>{/* app-specific nav */}</SidebarContent>
      <SidebarFooter>{/* app-specific footer */}</SidebarFooter>
    </>
  }
  breadcrumbs={[{ label: 'Category' }, { label: 'Board' }]}
>
  <BoardWorkspace />
</AppShell>
```

If the app needs to own the full sidebar provider/sidebar/inset structure, use
the sidebar primitives directly instead of `AppShell preset="custom"`.
Custom sidebar content does not receive generated navigation labels: supply
`tooltip` and accessible labels on its icon-only `SidebarMenuButton` controls.

## Import Paths

Use the high-level shell for normal app work:

```tsx
import { AppShell } from '@zero/framework/react';
```

Use sidebar primitives for advanced composition:

```tsx
import {
  SidebarProvider,
  Sidebar,
  SidebarInset,
  SidebarTrigger,
  SidebarMenu,
  SidebarMenuButton,
} from '@zero/framework/components/sidebar';
```

Common rule: if a dashboard, admin, CRM, workflow, or data app can fit
`AppShell`, do not hand-roll the shell. Configure `AppShell` first, use custom
slots second, and use raw primitives only for highly custom shells.
