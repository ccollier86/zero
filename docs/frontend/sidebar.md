# Sidebar

Zero's dashboard `AppShell` is built on the Animate UI/Radix sidebar primitive
family. Most apps should use `AppShell` first. Use these primitives directly
when an app needs a custom shell but still wants the packaged collapsible
sidebar behavior, mobile sheet, rail, menu highlighting, dropdown menus, and
animated collapsible sections.

## Imports

```tsx
import {
  SidebarProvider,
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarFooter,
  SidebarInset,
  SidebarRail,
  SidebarTrigger,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuItem,
  SidebarMenuButton,
  SidebarMenuAction,
  SidebarMenuSub,
  SidebarMenuSubItem,
  SidebarMenuSubButton,
} from '@zero/framework/components/sidebar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@zero/framework/components/dropdown-menu';
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@zero/framework/components/collapsible';
import { Avatar, AvatarFallback, AvatarImage } from '@zero/framework/react';
import { ChevronDown, ChevronRight, Layers, Terminal } from '@zero/framework/icons';
import { MoreHorizontal } from 'lucide-react';
```

## Layout Skeleton

This is the low-level version of the default dashboard shell.

```tsx
<SidebarProvider>
  <Sidebar collapsible="icon">
    <SidebarHeader>{/* workspace switcher */}</SidebarHeader>
    <SidebarContent>{/* nav groups */}</SidebarContent>
    <SidebarFooter>{/* user menu */}</SidebarFooter>
    <SidebarRail />
  </Sidebar>

  <SidebarInset>
    <header className="flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12">
      <div className="flex items-center gap-2 px-4">
        <SidebarTrigger className="-ml-1" />
        {/* separator + breadcrumbs/title/actions */}
      </div>
    </header>
    <div className="flex flex-1 flex-col gap-4 p-4 pt-0">
      {children}
    </div>
  </SidebarInset>
</SidebarProvider>
```

The header row belongs to `SidebarInset`. It is intentionally light: no
mandatory bottom border and no heavy app-bar surface. Put breadcrumbs, title,
search, filters, or actions there as the app needs.

## Top Workspace Switcher

Use a `DropdownMenu` around a large `SidebarMenuButton` to recreate the
Animate UI team/workspace switcher.

```tsx
<SidebarHeader>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <div className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
              <Layers className="size-4" />
            </div>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">Acme Inc</span>
              <span className="truncate text-xs">Enterprise</span>
            </div>
            <ChevronDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          align="start"
          side="right"
          sideOffset={4}
        >
          <DropdownMenuLabel className="text-xs text-muted-foreground">
            Teams
          </DropdownMenuLabel>
          <DropdownMenuItem className="gap-2 p-2">
            Acme Inc
            <DropdownMenuShortcut>⌘1</DropdownMenuShortcut>
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</SidebarHeader>
```

If the app does not need custom behavior, prefer the `AppShell workspaces`
configuration instead.

## Collapsible Nested Navigation

Use `Collapsible` with `SidebarMenuButton` for expandable sections. The nested
items render through `SidebarMenuSub`.

```tsx
<SidebarGroup>
  <SidebarGroupLabel>Platform</SidebarGroupLabel>
  <SidebarMenu>
    <Collapsible defaultOpen className="group/collapsible" asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton tooltip="Playground">
            <Terminal className="size-4" />
            <span>Playground</span>
            <ChevronRight className="ml-auto transition-transform duration-300 group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            <SidebarMenuSubItem>
              <SidebarMenuSubButton asChild>
                <a href="/history"><span>History</span></a>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  </SidebarMenu>
</SidebarGroup>
```

## Three-Dot Item Actions

Use `SidebarMenuAction showOnHover` with `DropdownMenu` for project/card-style
context actions.

```tsx
<SidebarMenuItem>
  <SidebarMenuButton asChild>
    <a href="/projects/design">
      <Layers className="size-4" />
      <span>Design Engineering</span>
    </a>
  </SidebarMenuButton>
  <DropdownMenu>
    <DropdownMenuTrigger asChild>
      <SidebarMenuAction showOnHover>
        <MoreHorizontal className="size-4" />
        <span className="sr-only">Project actions</span>
      </SidebarMenuAction>
    </DropdownMenuTrigger>
    <DropdownMenuContent className="w-48 rounded-lg" side="right" align="start">
      <DropdownMenuItem>View project</DropdownMenuItem>
      <DropdownMenuItem>Share project</DropdownMenuItem>
      <DropdownMenuSeparator />
      <DropdownMenuItem variant="destructive">Delete project</DropdownMenuItem>
    </DropdownMenuContent>
  </DropdownMenu>
</SidebarMenuItem>
```

## Footer User Menu

The footer user button is the same dropdown pattern with `Avatar`.

```tsx
<SidebarFooter>
  <SidebarMenu>
    <SidebarMenuItem>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <SidebarMenuButton size="lg">
            <Avatar className="h-8 w-8 rounded-lg">
              <AvatarImage src={user.avatarUrl} alt={user.name} />
              <AvatarFallback className="rounded-lg">CA</AvatarFallback>
            </Avatar>
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{user.name}</span>
              <span className="truncate text-xs">{user.email}</span>
            </div>
            <ChevronDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
          side="right"
          align="end"
          sideOffset={4}
        >
          <DropdownMenuItem>Account</DropdownMenuItem>
          <DropdownMenuItem>Notifications</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem>Log out</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </SidebarMenuItem>
  </SidebarMenu>
</SidebarFooter>
```

For normal auth-backed apps, prefer `AppShell user` and `AppShell userMenu`;
the shell renders this footer pattern for you.

## Primitive Reference

| Primitive | Purpose |
|-----------|---------|
| `SidebarProvider` | Root provider, desktop/mobile state, keyboard shortcut, token widths. |
| `Sidebar` | Sidebar surface. Supports `collapsible="icon"`, `offcanvas`, or `none`. |
| `SidebarInset` | Main content surface beside the sidebar. |
| `SidebarTrigger` | Button that toggles desktop collapse or mobile sheet. |
| `SidebarHeader` | Top region, usually workspace switcher or brand. |
| `SidebarContent` | Scrollable middle nav area. |
| `SidebarFooter` | Bottom user menu or app footer actions. |
| `SidebarRail` | Edge hit target for collapse/expand behavior. |
| `SidebarGroup` | Grouped navigation section. |
| `SidebarGroupLabel` | Collapsible-aware group label. |
| `SidebarMenu` | Navigation list. |
| `SidebarMenuItem` | Relative item wrapper. |
| `SidebarMenuButton` | Main nav action with active, size, variant, and tooltip support. |
| `SidebarMenuAction` | Hover/context action aligned to a menu item. |
| `SidebarMenuSub` | Nested nav list. |
| `SidebarMenuSubButton` | Nested nav action. |

## Common Rules

- Use `AppShell` for normal dashboards and admin apps.
- Use `AppShell` custom slots before copying the primitive skeleton.
- Use raw sidebar primitives when the layout is truly custom.
- Keep sidebar data as simple config where possible so agents and users can see
  app navigation clearly.
- Use Zero animated icons from `@zero/framework/icons` before raw
  `lucide-react`; use raw Lucide only when Zero does not ship that icon shape.
