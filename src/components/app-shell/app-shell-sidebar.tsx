'use client';

/**
 * app-shell-sidebar.tsx
 *
 * Composes Zero's default dashboard sidebar from the exported sidebar,
 * dropdown, collapsible, avatar, and icon primitives. This file owns sidebar
 * composition only; AppShell owns the outer layout.
 */

import * as React from 'react';
import { MoreHorizontal } from 'lucide-react';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/collapsible';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuTrigger,
} from '@/components/dropdown-menu';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
} from '@/components/sidebar';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  AnimateIcon,
  Bell,
  ChevronDown,
  ChevronRight,
  LogOut,
  Plus,
  Settings,
  User,
} from '@/components/animate-ui/icons';
import { useIsMobile } from '@/hooks/use-mobile';
import { cn } from '@/lib/utils';
import type {
  AppShellBrand,
  AppShellMenuItem,
  AppShellNavGroup,
  AppShellNavItem,
  AppShellUser,
  AppShellWorkspace,
  AppShellWorkspaceConfig,
} from './app-shell.types';
import {
  AppShellAnchor,
  getInitials,
  renderAppShellIcon,
} from './app-shell-utils';

export interface AppShellSidebarProps {
  brand?: AppShellBrand;
  nav?: AppShellNavGroup[];
  secondaryNav?: AppShellNavGroup[];
  workspaces?: AppShellWorkspaceConfig;
  user?: AppShellUser | null;
  userMenu?: AppShellMenuItem[];
  footer?: React.ReactNode;
  currentPath?: string;
  customSidebar?: React.ReactNode;
}

/** Default dashboard sidebar for Zero AppShell. */
export function AppShellSidebar({
  brand,
  nav = [],
  secondaryNav = [],
  workspaces,
  user,
  userMenu,
  footer,
  currentPath,
  customSidebar,
}: AppShellSidebarProps) {
  if (customSidebar) {
    return (
      <Sidebar collapsible="icon">
        {customSidebar}
        <SidebarRail />
      </Sidebar>
    );
  }

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            {workspaces ? (
              <AppShellWorkspaceSwitcher
                brand={brand}
                workspaces={workspaces}
              />
            ) : (
              <AppShellBrandButton brand={brand} />
            )}
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>

      <SidebarContent>
        <AppShellNavGroups groups={nav} currentPath={currentPath} />
        <AppShellNavGroups groups={secondaryNav} currentPath={currentPath} secondary />
      </SidebarContent>

      <SidebarFooter>
        {footer}
        {user ? <AppShellUserMenu user={user} items={userMenu} /> : null}
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  );
}

function AppShellBrandButton({ brand }: { brand?: AppShellBrand }) {
  if (!brand) return null;

  const content = (
    <>
      <AppShellLogo icon={brand.icon} logo={brand.logo} fallback={brand.name} />
      <div className="grid flex-1 text-left text-sm leading-tight">
        <span className="truncate font-semibold">{brand.name}</span>
        {brand.subtitle ? (
          <span className="truncate text-xs">{brand.subtitle}</span>
        ) : null}
      </div>
    </>
  );

  if (brand.href) {
    return (
      <AnimatedIconTrigger>
        <SidebarMenuButton
          size="lg"
          asChild
          className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
        >
          <a href={brand.href}>{content}</a>
        </SidebarMenuButton>
      </AnimatedIconTrigger>
    );
  }

  return (
    <AnimatedIconTrigger>
      <SidebarMenuButton
        size="lg"
        className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
      >
        {content}
      </SidebarMenuButton>
    </AnimatedIconTrigger>
  );
}

function AppShellWorkspaceSwitcher({
  brand,
  workspaces,
}: {
  brand?: AppShellBrand;
  workspaces: AppShellWorkspaceConfig;
}) {
  const isMobile = useIsMobile();
  const activeWorkspace = workspaces.items.find((item) => item.id === workspaces.activeId)
    ?? workspaces.items[0];
  const displayWorkspace = activeWorkspace ?? {
    id: '__zero-empty-workspace',
    name: workspaces.label ?? brand?.name ?? 'Workspace',
    subtitle: 'No items yet',
    icon: brand?.icon,
    logo: brand?.logo,
  };

  if (!activeWorkspace && !workspaces.onCreate) return <AppShellBrandButton brand={brand} />;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AnimatedIconTrigger>
          <SidebarMenuButton
            size="lg"
            className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
          >
            <AppShellLogo
              icon={displayWorkspace.icon ?? brand?.icon}
              logo={displayWorkspace.logo ?? brand?.logo}
              fallback={displayWorkspace.name}
            />
            <div className="grid flex-1 text-left text-sm leading-tight">
              <span className="truncate font-semibold">{displayWorkspace.name}</span>
              {displayWorkspace.subtitle ? (
                <span className="truncate text-xs">{displayWorkspace.subtitle}</span>
              ) : null}
            </div>
            <ChevronDown className="ml-auto size-4" />
          </SidebarMenuButton>
        </AnimatedIconTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
        align="start"
        side={isMobile ? 'bottom' : 'right'}
        sideOffset={4}
      >
        <DropdownMenuLabel className="text-xs text-muted-foreground">
          {workspaces.label ?? 'Workspaces'}
        </DropdownMenuLabel>
        {workspaces.items.length ? (
          workspaces.items.map((workspace, index) => (
            <AnimatedIconTrigger key={workspace.id}>
              <DropdownMenuItem
                onClick={() => workspaces.onSelect?.(workspace)}
                className="gap-2 p-2"
              >
                <AppShellLogo
                  icon={workspace.icon}
                  logo={workspace.logo}
                  fallback={workspace.name}
                  className="size-6 rounded-sm border bg-background text-foreground"
                  iconClassName="size-4"
                />
                <span className="min-w-0 flex-1 truncate">{workspace.name}</span>
                <DropdownMenuShortcut>{workspace.shortcut ?? `⌘${index + 1}`}</DropdownMenuShortcut>
              </DropdownMenuItem>
            </AnimatedIconTrigger>
          ))
        ) : (
          <DropdownMenuItem disabled className="gap-2 p-2 text-muted-foreground">
            No items yet
          </DropdownMenuItem>
        )}
        {workspaces.activeActions?.length ? (
          <>
            <DropdownMenuSeparator />
            <AppShellMenuItems items={workspaces.activeActions} />
          </>
        ) : null}
        {workspaces.onCreate ? (
          <>
            <DropdownMenuSeparator />
            <AnimatedIconTrigger>
              <DropdownMenuItem className="gap-2 p-2" onClick={workspaces.onCreate}>
                <div className="flex size-6 items-center justify-center rounded-md border bg-background">
                  <Plus className="size-4" />
                </div>
                <span className="font-medium text-muted-foreground">
                  {workspaces.createLabel ?? 'Add workspace'}
                </span>
              </DropdownMenuItem>
            </AnimatedIconTrigger>
          </>
        ) : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppShellNavGroups({
  groups,
  currentPath,
  secondary = false,
}: {
  groups: AppShellNavGroup[];
  currentPath?: string;
  secondary?: boolean;
}) {
  return (
    <>
      {groups.map((group, index) => (
        <SidebarGroup
          key={group.id ?? group.label ?? index}
          className={cn(group.hideWhenCollapsed && 'group-data-[collapsible=icon]:hidden')}
        >
          {group.label ? <SidebarGroupLabel>{group.label}</SidebarGroupLabel> : null}
          <SidebarMenu>
            {group.items.map((item) => (
              <AppShellNavMenuItem
                key={item.id ?? item.href ?? item.label}
                item={item}
                currentPath={currentPath}
                secondary={secondary}
              />
            ))}
          </SidebarMenu>
        </SidebarGroup>
      ))}
    </>
  );
}

function AppShellNavMenuItem({
  item,
  currentPath,
  secondary,
}: {
  item: AppShellNavItem;
  currentPath?: string;
  secondary?: boolean;
}) {
  const isActive = isNavItemActive(item, currentPath);
  const hasChildren = Boolean(item.children?.length);

  if (hasChildren) {
    return (
      <Collapsible
        asChild
        defaultOpen={item.defaultOpen ?? isActive}
        className="group/collapsible"
      >
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <AnimatedIconTrigger>
              <SidebarMenuButton
                tooltip={item.tooltip ?? item.label}
                isActive={isActive}
                aria-disabled={item.disabled}
                className={getNavItemButtonClassName(item, secondary)}
                onClick={() => {
                  if (!item.disabled) item.onSelect?.();
                }}
              >
                {renderAppShellIcon({ icon: item.icon })}
                <span>{item.label}</span>
                <span className="ml-auto flex items-center gap-1">
                  {item.badge ? <span className="text-xs">{item.badge}</span> : null}
                  <ChevronRight className="size-4 transition-transform duration-300 group-data-[state=open]/collapsible:rotate-90" />
                </span>
              </SidebarMenuButton>
            </AnimatedIconTrigger>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub>
              {item.children?.map((subItem) => (
                <SidebarMenuSubItem key={subItem.id ?? subItem.href ?? subItem.label}>
                  <SidebarMenuSubButton
                    asChild
                    isActive={isNavItemActive(subItem, currentPath)}
                    aria-disabled={subItem.disabled}
                  >
                    <AnimatedIconTrigger>
                      <AppShellAnchor
                        href={subItem.href}
                        disabled={subItem.disabled}
                        onClick={subItem.onSelect}
                      >
                        {renderAppShellIcon({ icon: subItem.icon })}
                        <span>{subItem.label}</span>
                        {subItem.badge ? <span className="ml-auto text-xs">{subItem.badge}</span> : null}
                      </AppShellAnchor>
                    </AnimatedIconTrigger>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
          {item.actions?.length ? <AppShellNavActions item={item} /> : null}
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  return (
    <SidebarMenuItem>
      <AnimatedIconTrigger>
        <SidebarMenuButton
          asChild
          tooltip={item.tooltip ?? item.label}
          isActive={isActive}
          aria-disabled={item.disabled}
          className={getNavItemButtonClassName(item, secondary)}
        >
          <AppShellAnchor
            href={item.href}
            disabled={item.disabled}
            onClick={item.onSelect}
          >
            {renderAppShellIcon({ icon: item.icon })}
            <span>{item.label}</span>
            {item.badge ? <span className="ml-auto text-xs">{item.badge}</span> : null}
          </AppShellAnchor>
        </SidebarMenuButton>
      </AnimatedIconTrigger>
      {item.actions?.length ? <AppShellNavActions item={item} /> : null}
    </SidebarMenuItem>
  );
}

function AppShellNavActions({ item }: { item: AppShellNavItem }) {
  const isMobile = useIsMobile();

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <AnimatedIconTrigger>
          <SidebarMenuAction showOnHover>
            <MoreHorizontal />
            <span className="sr-only">More actions for {item.label}</span>
          </SidebarMenuAction>
        </AnimatedIconTrigger>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        className="w-48 rounded-lg"
        side={isMobile ? 'bottom' : 'right'}
        align={isMobile ? 'end' : 'start'}
      >
        <AppShellMenuItems items={item.actions ?? []} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function AppShellUserMenu({
  user,
  items,
}: {
  user: AppShellUser;
  items?: AppShellMenuItem[];
}) {
  const isMobile = useIsMobile();
  const menuItems = items ?? buildDefaultUserMenu(user);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <AnimatedIconTrigger>
              <SidebarMenuButton
                size="lg"
                className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
              >
                <Avatar className="h-8 w-8 rounded-lg">
                  {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                  <AvatarFallback className="rounded-lg">
                    {user.fallback ?? getInitials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  {user.email ? <span className="truncate text-xs">{user.email}</span> : null}
                </div>
                <ChevronDown className="ml-auto size-4" />
              </SidebarMenuButton>
            </AnimatedIconTrigger>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-lg"
            side={isMobile ? 'bottom' : 'right'}
            align="end"
            sideOffset={4}
          >
            <DropdownMenuLabel className="p-0 font-normal">
              <div className="flex items-center gap-2 px-1 py-1.5 text-left text-sm">
                <Avatar className="h-8 w-8 rounded-lg">
                  {user.avatar ? <AvatarImage src={user.avatar} alt={user.name} /> : null}
                  <AvatarFallback className="rounded-lg">
                    {user.fallback ?? getInitials(user.name, user.email)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-semibold">{user.name}</span>
                  {user.email ? <span className="truncate text-xs">{user.email}</span> : null}
                </div>
              </div>
            </DropdownMenuLabel>
            {menuItems.length ? (
              <>
                <DropdownMenuSeparator />
                <AppShellMenuItems items={menuItems} />
              </>
            ) : null}
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

function AppShellMenuItems({ items }: { items: AppShellMenuItem[] }) {
  return (
    <>
      {items.map((item, index) => {
        if (item.type === 'separator') {
          return <DropdownMenuSeparator key={item.id ?? `separator-${index}`} />;
        }

        if (item.type === 'label') {
          return (
            <DropdownMenuLabel key={item.id ?? item.label} className="text-xs text-muted-foreground">
              {item.label}
            </DropdownMenuLabel>
          );
        }

        const content = (
          <>
            {renderAppShellIcon({ icon: item.icon })}
            <span>{item.label}</span>
            {item.shortcut ? <DropdownMenuShortcut>{item.shortcut}</DropdownMenuShortcut> : null}
          </>
        );

        return (
          <AnimatedIconTrigger key={item.id ?? item.href ?? item.label}>
            <DropdownMenuItem
              variant={item.destructive ? 'destructive' : 'default'}
              disabled={item.disabled}
              onClick={() => {
                item.onSelect?.();
                if (item.href) window.location.href = item.href;
              }}
            >
              {content}
            </DropdownMenuItem>
          </AnimatedIconTrigger>
        );
      })}
    </>
  );
}

function AppShellLogo({
  icon,
  logo,
  fallback,
  className,
  iconClassName,
}: {
  icon?: AppShellBrand['icon'] | AppShellWorkspace['icon'];
  logo?: React.ReactNode;
  fallback: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <div
      className={cn(
        'flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground',
        className,
      )}
    >
      {logo ?? renderAppShellIcon({ icon, className: iconClassName ?? 'size-4' }) ?? (
        <span className="text-xs font-semibold">{getInitials(fallback)}</span>
      )}
    </div>
  );
}

type AnimatedIconTriggerProps = Omit<
  React.ComponentProps<typeof AnimateIcon>,
  'asChild' | 'animateOnHover' | 'animateOnTap' | 'children'
> & {
  children: React.ReactElement;
};

const AnimatedIconTrigger = React.forwardRef<HTMLElement, AnimatedIconTriggerProps>(
  function AnimatedIconTrigger({ children, ...props }, ref) {
    return (
      <AnimateIcon
        asChild
        animateOnHover
        animateOnTap
        ref={ref as React.Ref<HTMLSpanElement>}
        {...props}
      >
        {children}
      </AnimateIcon>
    );
  },
);

function getNavItemButtonClassName(item: AppShellNavItem, secondary?: boolean): string | undefined {
  return cn(
    secondary && 'text-sidebar-foreground/90',
    item.variant === 'action'
      && 'mt-1 border border-dashed border-sidebar-border bg-sidebar-accent/35 font-medium text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
  );
}

function isNavItemActive(item: AppShellNavItem, currentPath?: string): boolean {
  if (item.active) return true;
  if (item.children?.some((child) => isNavItemActive(child, currentPath))) return true;
  if (!currentPath || !item.href) return false;
  return currentPath === item.href || currentPath.startsWith(`${item.href}/`);
}

function buildDefaultUserMenu(user: AppShellUser): AppShellMenuItem[] {
  const items: AppShellMenuItem[] = [];

  if (user.accountHref) {
    items.push({ label: 'Account', href: user.accountHref, icon: User });
  }

  if (user.notificationsHref) {
    items.push({ label: 'Notifications', href: user.notificationsHref, icon: Bell });
  }

  if (user.onLogout) {
    if (items.length) items.push({ type: 'separator' });
    items.push({ label: 'Log out', icon: LogOut, onSelect: user.onLogout });
  }

  if (items.length === 0) {
    items.push({ label: 'Settings', icon: Settings, disabled: true });
  }

  return items;
}
