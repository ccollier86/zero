'use client';

/**
 * app-shell.types.ts
 *
 * Shared contracts for Zero's app shell components. This file owns type
 * definitions only; rendering lives in focused shell components.
 */

import type * as React from 'react';
import type { ThemeTogglerButtonProps } from '@/components/animate-ui/components/buttons/theme-toggler';
import type {
  ZeroAnimatedIconComponent,
  ZeroAnimatedIconName,
} from '@/components/animate-ui/icons/registry';

export type AppShellPreset =
  | 'dashboard'
  | 'auth-dashboard'
  | 'simple-sidebar'
  | 'topbar'
  | 'minimal'
  | 'custom';

export type AppShellIcon =
  | ZeroAnimatedIconName
  | ZeroAnimatedIconComponent
  | React.ComponentType<{ className?: string; size?: number }>;

export interface AppShellBrand {
  name: string;
  subtitle?: string;
  icon?: AppShellIcon;
  logo?: React.ReactNode;
  href?: string;
}

export interface AppShellBreadcrumb {
  label: string;
  href?: string;
  icon?: AppShellIcon;
}

export interface AppShellWorkspace {
  id: string;
  name: string;
  subtitle?: string;
  icon?: AppShellIcon;
  logo?: React.ReactNode;
  shortcut?: string;
}

export interface AppShellWorkspaceConfig {
  activeId?: string;
  label?: string;
  createLabel?: string;
  items: AppShellWorkspace[];
  activeActions?: AppShellMenuItem[];
  onCreate?(): void;
  onSelect?(workspace: AppShellWorkspace): void;
}

export type AppShellMenuItem =
  | { type: 'separator'; id?: string }
  | { type: 'label'; id?: string; label: string }
  | {
      type?: 'item';
      id?: string;
      label: string;
      icon?: AppShellIcon;
      href?: string;
      shortcut?: string;
      destructive?: boolean;
      disabled?: boolean;
      onSelect?(): void;
    };

export interface AppShellNavItem {
  id?: string;
  label: string;
  href?: string;
  icon?: AppShellIcon;
  variant?: 'default' | 'action';
  active?: boolean;
  defaultOpen?: boolean;
  disabled?: boolean;
  badge?: string | number;
  tooltip?: string;
  children?: AppShellNavItem[];
  actions?: AppShellMenuItem[];
  onSelect?(): void;
}

export interface AppShellNavGroup {
  id?: string;
  label?: string;
  hideWhenCollapsed?: boolean;
  items: AppShellNavItem[];
}

export interface AppShellUser {
  name: string;
  email?: string;
  avatar?: string;
  fallback?: string;
  accountHref?: string;
  notificationsHref?: string;
  onLogout?(): void;
}

export type AppShellThemeToggleConfig = Omit<ThemeTogglerButtonProps, 'children'>;

export interface AppShellHeaderConfig {
  hide?: boolean;
  showSidebarTrigger?: boolean;
  breadcrumbs?: AppShellBreadcrumb[] | false;
  title?: string;
  subtitle?: string;
  leading?: React.ReactNode;
  content?: React.ReactNode;
  actions?: React.ReactNode;
  themeToggle?: boolean | AppShellThemeToggleConfig;
  trailing?: React.ReactNode;
  className?: string;
}

export interface AppShellProps {
  preset?: AppShellPreset;
  brand?: AppShellBrand;
  nav?: AppShellNavGroup[];
  secondaryNav?: AppShellNavGroup[];
  workspaces?: AppShellWorkspaceConfig;
  user?: AppShellUser | null;
  userMenu?: AppShellMenuItem[];
  breadcrumbs?: AppShellBreadcrumb[] | false;
  header?: AppShellHeaderConfig | false;
  sidebar?: React.ReactNode | false;
  footer?: React.ReactNode;
  actions?: React.ReactNode;
  currentPath?: string;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
  defaultSidebarOpen?: boolean;
  sidebarOpen?: boolean;
  onSidebarOpenChange?(open: boolean): void;
}
