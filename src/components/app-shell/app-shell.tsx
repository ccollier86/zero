'use client';

/**
 * app-shell.tsx
 *
 * High-level Zero AppShell. This file owns shell preset selection and outer
 * layout; sidebar, header, and breadcrumb details live in focused components.
 */

import { SidebarInset, SidebarProvider } from '#zero/components/sidebar';
import { cn } from '#zero/lib/utils';
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
  contentMode,
  children,
  defaultSidebarOpen,
  sidebarOpen,
  onSidebarOpenChange,
}: AppShellProps) {
  const headerConfig = resolveHeaderConfig(header, breadcrumbs, actions);
  const hideHeader = header === false || headerConfig.hide;
  const workspace = (contentMode ?? (preset === 'minimal' || preset === 'topbar' ? 'document' : 'workspace')) === 'workspace';
  const frame = workspace ? 'flex h-svh min-h-0 min-w-0 flex-col overflow-hidden' : 'min-h-screen';
  const content = workspace ? 'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden' : '';

  if (preset === 'minimal') {
    return (
      <main data-slot="app-shell" data-content-mode={workspace ? 'workspace' : 'document'} className={cn(frame, 'bg-background text-foreground', className)}>
        <div data-slot="app-shell-content" className={cn(workspace ? content : 'min-h-screen', contentClassName)}>{children}</div>
      </main>
    );
  }

  if (preset === 'topbar') {
    return (
      <main data-slot="app-shell" data-content-mode={workspace ? 'workspace' : 'document'} className={cn(frame, 'bg-background text-foreground', className)}>
        {!hideHeader ? (
          <AppShellHeader {...headerConfig} showSidebarTrigger={false} />
        ) : null}
        <div data-slot="app-shell-content" className={cn(content, 'p-4 pt-0', contentClassName)}>{children}</div>
      </main>
    );
  }

  if (preset === 'simple-sidebar') {
    return (
      <main data-slot="app-shell" data-content-mode={workspace ? 'workspace' : 'document'} className={cn(frame, 'bg-background text-foreground', className)}>
        <div className={cn('flex min-w-0 flex-col lg:flex-row', workspace ? 'min-h-0 flex-1 overflow-hidden' : 'min-h-screen')}>
          {sidebar ? (
            <aside className={cn('w-full shrink-0 border-b border-border bg-muted/25 lg:w-72 lg:border-b-0 lg:border-r', workspace ? 'min-h-0 max-h-[25svh] overflow-auto lg:max-h-none lg:h-full' : 'lg:min-h-screen')}>
              {sidebar}
            </aside>
          ) : null}
          <section className={cn('flex min-h-0 min-w-0 flex-1 flex-col', workspace && 'overflow-hidden')}>
            {!hideHeader ? (
              <AppShellHeader {...headerConfig} showSidebarTrigger={false} />
            ) : null}
            <div data-slot="app-shell-content" className={cn('min-h-0 flex-1 p-4 pt-0', content, contentClassName)}>
              {children}
            </div>
          </section>
        </div>
      </main>
    );
  }

  return (
    <SidebarProvider
      defaultOpen={defaultSidebarOpen}
      open={sidebarOpen}
      onOpenChange={onSidebarOpenChange}
      data-content-mode={workspace ? 'workspace' : 'document'}
      className={cn(workspace && 'h-svh min-h-0 overflow-hidden', className)}
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

      <SidebarInset className={cn('min-h-0 min-w-0', workspace && 'overflow-hidden')}>
        {!hideHeader ? <AppShellHeader {...headerConfig} /> : null}
        <div data-slot="app-shell-content" className={cn('flex min-h-0 min-w-0 flex-1 flex-col gap-4 p-4 pt-0', workspace && 'overflow-hidden', contentClassName)}>
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
