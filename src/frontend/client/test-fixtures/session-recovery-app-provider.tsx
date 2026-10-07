/** Real provider/client fixture; the browser test owns synthetic HTTP authority. */

import { createRoot } from 'react-dom/client';
import { AppProvider } from '../app-provider';
import { useAuth } from '../auth-hooks';
import { useAuthorization } from '../authorization-hooks';
import { usePathname } from '../router-context';
import { createClient, type InternalClient } from '../sdk';
import type { RouteAuthorizationBoundary } from '../../router/authorization-route-boundary';

export interface SessionRecoveryPaint {
  loader: RouteAuthorizationBoundary;
  browserUser: string | null;
  browserRole: string | null;
  browserTenant: string | null;
  browserRevision: string | null;
}

export interface SessionRecoveryHarness {
  snapshot(): {
    userId: string | null;
    hasRecoverableSession: boolean;
    isRestoring: boolean;
    authorizationStatus: string;
  };
  paints(): SessionRecoveryPaint[];
  login(username: string): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
  refreshAuthorization(): Promise<void>;
}

declare global {
  interface Window {
    __sessionRecoveryHarness: SessionRecoveryHarness;
    __sessionRecoveryLoader: RouteAuthorizationBoundary;
  }
}

const PAINTS_KEY = '__zero_test_session_recovery_paints';
const client = createClient({
  url: window.location.origin,
  tables: {},
  auth: true,
  autoConnect: false,
}) as InternalClient;

function paints(): SessionRecoveryPaint[] {
  return JSON.parse(window.sessionStorage.getItem(PAINTS_KEY) ?? '[]');
}

window.__sessionRecoveryHarness = {
  snapshot: () => ({
    userId: client.auth?.user?.userId ?? null,
    hasRecoverableSession: client.auth?.hasRecoverableSession ?? false,
    isRestoring: client.auth?.isRestoring ?? false,
    authorizationStatus: client.authorizationState.status,
  }),
  paints,
  async login(username) {
    await client.auth!.login(username, 'synthetic-password');
  },
  async switchTenant(tenantId) {
    await client.auth!.switchTenant(tenantId);
  },
  async refreshAuthorization() {
    await client.refreshAuthorization();
  },
};

function RouteContent() {
  const pathname = usePathname();
  const { user, activeTenant } = useAuth();
  const authorization = useAuthorization();
  if (pathname === '/login') return <form aria-label="Sign in">Sign in</form>;

  // Record renders, not just settled DOM: even a one-frame stale loader leak
  // across recovery/reload or account/tenant replacement fails qualification.
  const paint: SessionRecoveryPaint = {
    loader: window.__sessionRecoveryLoader,
    browserUser: user?.userId ?? null,
    browserRole: user?.role ?? null,
    browserTenant: activeTenant?.tenantId ?? null,
    browserRevision: authorization.isReady
      ? authorization.authorization?.scope?.revision ?? null
      : null,
  };
  window.sessionStorage.setItem(PAINTS_KEY, JSON.stringify([...paints(), paint]));
  return (
    <main data-testid="protected-loader">
      Loader {paint.loader.userId}/{paint.loader.scopeId}/{paint.loader.scopeRevision}
    </main>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Session-recovery browser fixture root is missing.');
createRoot(root).render(
  <AppProvider
    url={window.location.origin}
    tables={{}}
    auth
    publicPaths={['/login']}
    routeAuth="protected-by-default"
    loginPath="/login"
    initialPathname={window.location.pathname}
  >
    <RouteContent />
  </AppProvider>,
);
