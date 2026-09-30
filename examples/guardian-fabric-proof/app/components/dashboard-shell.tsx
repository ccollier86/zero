'use client';

import * as React from 'react';

import {
  AppShell,
  type AppShellMenuItem,
  type AppShellNavGroup,
} from '@zero/framework/components/app-shell';
import {
  useAuth,
  usePathname,
  useRouter,
  useTenantAppShellWorkspaces,
} from '@zero/framework/react/hooks';
import { toast } from '@zero/framework/react';

export interface DashboardShellProps {
  children: React.ReactNode;
}

/** Authenticated chrome and the Guardian-backed workspace switcher. */
export function DashboardShell({ children }: DashboardShellProps) {
  const pathname = usePathname();
  const router = useRouter();
  const auth = useAuth();
  const openWorkspaceCreation = React.useCallback(() => {
    router.push('/workspaces/new');
  }, [router]);
  const activeActions = React.useMemo(
    () => activeTenantActions(auth.activeTenant?.kind),
    [auth.activeTenant?.kind],
  );
  const workspaces = useTenantAppShellWorkspaces({
    hideWhenSingle: false,
    onCreate: openWorkspaceCreation,
    activeActions,
  });

  const nav = React.useMemo<AppShellNavGroup[]>(() => {
    const groups: AppShellNavGroup[] = [
      {
        id: 'workspace',
        label: 'Workspace',
        items: [
          { id: 'tasks', label: 'Tasks', href: '/app', icon: 'clipboard' },
          { id: 'organization', label: 'Workspace', href: '/organization', icon: 'users' },
          ...(auth.activeTenant?.kind === 'organization'
            ? [{ id: 'security', label: 'Security', href: '/security', icon: 'key' as const }]
            : []),
          {
            id: 'create-workspace',
            label: 'Create workspace',
            href: '/workspaces/new',
            icon: 'plus',
            variant: 'action',
          },
        ],
      },
    ];
    if (auth.activeTenant?.kind === 'administration') {
      groups.push({
        id: 'platform',
        label: 'Platform',
        items: [
          { id: 'platform-operations', label: 'Platform operations', href: '/platform', icon: 'lock' },
        ],
      });
    }
    return groups;
  }, [auth.activeTenant?.kind]);

  const displayName = [auth.user?.firstName, auth.user?.lastName]
    .filter(Boolean)
    .join(' ')
    || auth.user?.username
    || auth.user?.email
    || 'Signed-in user';
  const fallback = displayName
    .split(/\s+/u)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('');
  const page = pagePresentation(pathname);

  const logOut = React.useCallback(() => {
    void auth.logout()
      .then(() => router.replace('/login'))
      .catch((cause: unknown) => {
        toast.error(cause instanceof Error ? cause.message : 'Sign out failed.');
      });
  }, [auth.logout, router]);

  return (
    <AppShell
      preset="auth-dashboard"
      brand={{
        name: 'Guardian + Fabric',
        subtitle: 'Physical tenant proof',
        icon: 'layers',
        href: '/app',
      }}
      workspaces={workspaces}
      nav={nav}
      currentPath={pathname}
      header={{
        title: page.title,
        subtitle: page.subtitle,
        themeToggle: true,
      }}
      user={{
        name: displayName,
        email: auth.user?.email,
        fallback: fallback || undefined,
        onLogout: logOut,
      }}
      contentClassName="min-h-0"
    >
      {children}
    </AppShell>
  );
}

/** Keep the switcher's scope action aligned with the selected tenant kind. */
export function activeTenantActions(
  kind: 'administration' | 'organization' | undefined,
): AppShellMenuItem[] {
  return kind === 'administration'
    ? [{
        id: 'platform-operations',
        label: 'Platform operations',
        icon: 'lock',
        href: '/platform',
      }]
    : [{
        id: 'workspace-settings',
        label: 'Workspace settings',
        icon: 'settings',
        href: '/organization',
      }];
}

function pagePresentation(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/organization') {
    return {
      title: 'Workspace',
      subtitle: 'Membership, onboarding, credentials, and workspace authorization events.',
    };
  }
  if (pathname === '/security') {
    return {
      title: 'Security',
      subtitle: 'Finite automation credentials bound to your live workspace authority.',
    };
  }
  if (pathname === '/platform') {
    return {
      title: 'Platform operations',
      subtitle: 'Protected Administration Organization controls and audit history.',
    };
  }
  if (pathname === '/workspaces/new') {
    return {
      title: 'Create workspace',
      subtitle: 'Create and activate another physically isolated customer workspace.',
    };
  }
  return {
    title: 'Realtime task board',
    subtitle: 'Live rows from the active workspace database.',
  };
}
