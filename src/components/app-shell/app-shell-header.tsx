'use client';

/**
 * app-shell-header.tsx
 *
 * Renders the integrated inset header row used by Zero's default dashboard
 * shell. Breadcrumbs, title, custom content, and actions are optional slots.
 */

import { ThemeTogglerButton } from '#zero/components/animate-ui/components/buttons/theme-toggler';
import { SidebarTrigger } from '#zero/components/sidebar';
import { Separator } from '#zero/components/ui/separator';
import { cn } from '#zero/lib/utils';
import type {
  AppShellBreadcrumb,
  AppShellHeaderConfig,
  AppShellThemeToggleConfig,
} from './app-shell.types';
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
  themeToggle,
  trailing,
  className,
}: AppShellHeaderProps) {
  const hasPrimaryContent = Boolean(content || breadcrumbs || title || subtitle || leading);
  const themeToggleConfig = resolveThemeToggleConfig(themeToggle);

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

      {themeToggleConfig || actions || trailing ? (
        <div className="flex shrink-0 items-center gap-2 px-4">
          {actions}
          {themeToggleConfig ? <ThemeTogglerButton {...themeToggleConfig} /> : null}
          {trailing}
        </div>
      ) : null}
    </header>
  );
}

function resolveThemeToggleConfig(
  themeToggle: AppShellHeaderConfig['themeToggle'],
): AppShellThemeToggleConfig | null {
  if (!themeToggle) return null;
  if (themeToggle === true) {
    return {
      variant: 'ghost',
      size: 'default',
      modes: ['light', 'dark'],
      direction: 'ltr',
      className: 'text-muted-foreground hover:text-foreground',
    };
  }

  return {
    variant: 'ghost',
    size: 'default',
    modes: ['light', 'dark'],
    direction: 'ltr',
    ...themeToggle,
    className: cn('text-muted-foreground hover:text-foreground', themeToggle.className),
  };
}
