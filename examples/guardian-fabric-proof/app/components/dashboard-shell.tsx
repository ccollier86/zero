'use client';

import * as React from 'react';

import {
  getAuthDisplayMessage,
  reportAuthUiError,
} from '@zero/framework/components/auth';
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

  const nav = React.useMemo(
    () => dashboardNavigation(auth.activeTenant?.kind),
    [auth.activeTenant?.kind],
  );

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
        reportAuthUiError('logout', cause);
        toast.error(getAuthDisplayMessage(cause, 'Sign out failed.'));
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
  if (kind === undefined) return [];
  return kind === 'administration'
    ? [{
        id: 'platform-operations',
        label: 'Platform operations',
        icon: 'lock',
        href: '/platform',
      }]
    : [{
        id: 'workspace-settings',
        label: 'Members & access',
        icon: 'settings',
        href: '/organization',
      }];
}

/** Keep navigation aligned with routes that can operate in the active scope. */
export function dashboardNavigation(
  kind: 'administration' | 'organization' | undefined,
): AppShellNavGroup[] {
  const overview: AppShellNavGroup = {
    id: 'proof',
    label: 'Proof lab',
    items: [
      { id: 'proof-center', label: 'Proof center', href: '/app', icon: 'layers' },
      ...(kind === 'organization' ? [
        { id: 'tasks', label: 'Realtime tasks', href: '/tasks', icon: 'clipboard' as const },
        { id: 'organization', label: 'Members & access', href: '/organization', icon: 'users' as const },
        { id: 'security', label: 'Security', href: '/security', icon: 'key' as const },
      ] : []),
      {
        id: 'request-access',
        label: 'Request workspace access',
        href: '/request-access',
        icon: 'log-in',
      },
      {
        id: 'create-workspace',
        label: 'Create workspace',
        href: '/workspaces/new',
        icon: 'plus',
        variant: 'action',
      },
    ],
  };
  if (kind !== 'administration') return [overview];
  return [overview, {
    id: 'platform',
    label: 'Platform',
    items: [
      { id: 'platform-operations', label: 'Platform operations', href: '/platform', icon: 'lock' },
    ],
  }];
}

function pagePresentation(pathname: string): { title: string; subtitle: string } {
  if (pathname === '/organization') {
    return {
      title: 'Members & access',
      subtitle: 'Membership, onboarding, credentials, and workspace authorization events.',
    };
  }
  if (pathname === '/tasks') {
    return {
      title: 'Realtime task board',
      subtitle: 'Live actor-owned rows from the active physical workspace database.',
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
  if (pathname === '/request-access') {
    return {
      title: 'Request workspace access',
      subtitle: 'Submit a retained, non-enumerating membership request by workspace slug.',
    };
  }
  return {
    title: 'Guardian + Fabric proof center',
    subtitle: 'Live authority, realm readiness, realtime health, and guided acceptance.',
  };
}
