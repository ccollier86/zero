'use client';

/**
 * app-shell-breadcrumbs.tsx
 *
 * Renders Zero AppShell breadcrumb data through the platform breadcrumb
 * primitive. This file owns breadcrumb presentation only.
 */

import * as React from 'react';

import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { cn } from '@/lib/utils';
import type { AppShellBreadcrumb } from './app-shell.types';
import { renderAppShellIcon } from './app-shell-utils';

export interface AppShellBreadcrumbsProps {
  items?: AppShellBreadcrumb[] | false;
  className?: string;
}

/** Compact breadcrumb trail for the default inset app-shell header. */
export function AppShellBreadcrumbs({
  items,
  className,
}: AppShellBreadcrumbsProps) {
  if (!items || items.length === 0) return null;

  return (
    <Breadcrumb className={cn('min-w-0', className)}>
      <BreadcrumbList className="flex-nowrap overflow-hidden">
        {items.map((item, index) => {
          const isLast = index === items.length - 1;

          return (
            <React.Fragment key={`${item.label}-${index}`}>
              <BreadcrumbItem className={cn(!isLast && 'hidden md:inline-flex')}>
                {isLast || !item.href ? (
                  <BreadcrumbPage className="inline-flex min-w-0 items-center gap-1.5 truncate">
                    {renderAppShellIcon({ icon: item.icon, className: 'size-3.5 shrink-0' })}
                    <span className="truncate">{item.label}</span>
                  </BreadcrumbPage>
                ) : (
                  <BreadcrumbLink
                    href={item.href}
                    className="inline-flex min-w-0 items-center gap-1.5 truncate"
                  >
                    {renderAppShellIcon({ icon: item.icon, className: 'size-3.5 shrink-0' })}
                    <span className="truncate">{item.label}</span>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
              {!isLast ? <BreadcrumbSeparator className="hidden md:block" /> : null}
            </React.Fragment>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}
