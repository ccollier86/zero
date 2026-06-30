'use client';

/**
 * app-shell.tsx
 *
 * High-level Zero AppShell. This file owns shell preset selection and outer
 * layout; sidebar, header, and breadcrumb details live in focused components.
 */

import { SidebarInset, SidebarProvider } from '@/components/sidebar';
import { cn } from '@/lib/utils';
import { AppShellHeader } from './app-shell-header';
import { AppShellSidebar } from './app-shell-sidebar';
import type { AppShellHeaderConfig, AppShellProps } from './app-shell.types';

/** Zero's default dashboard shell with optional simpler layout presets. */
export function AppShell({
  preset = 'dashboard',
  brand,
  nav,
  secondaryNav,
  workspaces,
  user,
  userMenu,
  breadcrumbs,
  header,
  sidebar,
  footer,
  actions,
  currentPath,
  className,
  contentClassName,
  children,
  defaultSidebarOpen,
  sidebarOpen,
  onSidebarOpenChange,
}: AppShellProps) {
  if (preset === 'minimal') {
    return (
      <main className={cn('min-h-screen bg-background text-foreground', className)}>
        <div className={cn('min-h-screen', contentClassName)}>{children}</div>
      </main>
    );
  }

  if (preset === 'topbar') {
    return (
      <main className={cn('min-h-screen bg-background text-foreground', className)}>
        <AppShellHeader
          {...resolveHeaderConfig(header, breadcrumbs, actions)}
          showSidebarTrigger={false}
        />
        <div className={cn('p-4 pt-0', contentClassName)}>{children}</div>
      </main>
    );
  }

  if (preset === 'simple-sidebar') {
    return (
      <main className={cn('min-h-screen bg-background text-foreground', className)}>
        <div className="flex min-h-screen flex-col lg:flex-row">
          {sidebar ? (
            <aside className="w-full shrink-0 border-b border-border bg-muted/25 lg:min-h-screen lg:w-72 lg:border-b-0 lg:border-r">
              {sidebar}
            </aside>
          ) : null}
          <section className="flex min-w-0 flex-1 flex-col">
            <AppShellHeader
              {...resolveHeaderConfig(header, breadcrumbs, actions)}
              showSidebarTrigger={false}
            />
            <div className={cn('min-h-0 flex-1 p-4 pt-0', contentClassName)}>
              {children}
            </div>
          </section>
        </div>
      </main>
    );
  }

  const headerConfig = resolveHeaderConfig(header, breadcrumbs, actions);
  const hideHeader = header === false || headerConfig.hide;

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      open={sidebarOpen}
      onOpenChange={onSidebarOpenChange}
      className={className}
    >
      {sidebar !== false ? (
        <AppShellSidebar
          brand={brand}
          nav={nav}
          secondaryNav={secondaryNav}
          workspaces={workspaces}
          user={user}
          userMenu={userMenu}
          footer={footer}
          currentPath={currentPath}
          customSidebar={preset === 'custom' ? sidebar : undefined}
        />
      ) : null}

      <SidebarInset>
        {!hideHeader ? <AppShellHeader {...headerConfig} /> : null}
        <div className={cn('flex flex-1 flex-col gap-4 p-4 pt-0', contentClassName)}>
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function resolveHeaderConfig(
  header: AppShellProps['header'],
  breadcrumbs: AppShellProps['breadcrumbs'],
  actions: AppShellProps['actions'],
): AppShellHeaderConfig {
  if (header === false) return { hide: true };

  return {
    breadcrumbs,
    actions,
    ...header,
  };
}
