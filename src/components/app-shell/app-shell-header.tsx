'use client';

/**
 * app-shell-header.tsx
 *
 * Renders the integrated inset header row used by Zero's default dashboard
 * shell. Breadcrumbs, title, custom content, and actions are optional slots.
 */

import { SidebarTrigger } from '@/components/sidebar';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';
import type { AppShellBreadcrumb, AppShellHeaderConfig } from './app-shell.types';
import { AppShellBreadcrumbs } from './app-shell-breadcrumbs';

export interface AppShellHeaderProps extends Omit<AppShellHeaderConfig, 'hide'> {
  breadcrumbs?: AppShellBreadcrumb[] | false;
}

/** Integrated AppShell header row that sits inside SidebarInset. */
export function AppShellHeader({
  showSidebarTrigger = true,
  breadcrumbs,
  title,
  subtitle,
  leading,
  content,
  actions,
  trailing,
  className,
}: AppShellHeaderProps) {
  const hasPrimaryContent = Boolean(content || breadcrumbs || title || subtitle || leading);

  return (
    <header
      className={cn(
        'flex h-16 shrink-0 items-center gap-2 transition-[width,height] ease-linear group-has-[[data-collapsible=icon]]/sidebar-wrapper:h-12',
        className,
      )}
    >
      <div className="flex min-w-0 flex-1 items-center gap-2 px-4">
        {showSidebarTrigger ? (
          <>
            <SidebarTrigger className="-ml-1" />
            {hasPrimaryContent ? (
              <Separator orientation="vertical" className="mr-2 h-4" />
            ) : null}
          </>
        ) : null}

        {leading}

        {content ?? (
          breadcrumbs ? (
            <AppShellBreadcrumbs items={breadcrumbs} />
          ) : title || subtitle ? (
            <div className="min-w-0">
              {title ? <div className="truncate text-sm font-semibold">{title}</div> : null}
              {subtitle ? (
                <div className="truncate text-xs text-muted-foreground">{subtitle}</div>
              ) : null}
            </div>
          ) : null
        )}
      </div>

      {actions || trailing ? (
        <div className="flex shrink-0 items-center gap-2 px-4">
          {actions}
          {trailing}
        </div>
      ) : null}
    </header>
  );
}
