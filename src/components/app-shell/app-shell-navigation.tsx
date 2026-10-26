'use client';
/** One shell-local anchor adapter, including portaled built-in menus. No router singleton or history workaround. */
import { createContext, useContext, type ComponentType, type ReactNode } from 'react';
import type { AppShellLinkProps } from './app-shell.types';

const NavigationContext = createContext<ComponentType<AppShellLinkProps> | null>(null);

/** @internal AppShell owns this boundary; nested shells do not inherit an unrelated adapter. */
export function AppShellNavigationProvider({ component, children }: {
  component?: ComponentType<AppShellLinkProps>;
  children?: ReactNode;
}) {
  return <NavigationContext.Provider value={component ?? null}>{children}</NavigationContext.Provider>;
}

/** @internal Native fallback keeps independently composed shell primitives usable outside RouterProvider. */
export function useAppShellLinkComponent() { return useContext(NavigationContext) ?? 'a'; }
