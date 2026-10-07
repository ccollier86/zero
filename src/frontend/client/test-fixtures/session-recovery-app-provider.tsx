/** Real provider/client fixture; the browser test owns synthetic HTTP authority. */

import { createRoot } from 'react-dom/client';
import { AppProvider } from '../app-provider';
import { useAuth } from '../auth-hooks';
import { useAuthorization } from '../authorization-hooks';
import { usePathname } from '../router-context';
import { createClient, type InternalClient } from '../sdk';
import type { RouteAuthorizationBoundary } from '../../router/authorization-route-boundary';
import { AuthorizationHintRecovery } from '../authorization-hint-recovery';
import type { AuthClient } from '../auth-client';

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
    isLoading: boolean;
    transitionPhase: string;
    tenantId: string | null;
    authorizationStatus: string;
  };
  paints(): SessionRecoveryPaint[];
  /** Count every committed recovery alert, including one removed before settling. */
  recoveryPaintCount(): number;
  /** Reproduce the SDK's post-Sync authority purge without a synthetic socket. */
  invalidateAuthorizationData(): void;
  unmountProvider(): void;
  hintRetryClientProbe(action: 'mount' | 'replace' | 'finish-old'): { calls: number; aborted: number };
  login(username: string, password?: string): Promise<void>;
  logout(): Promise<void>;
  switchTenant(tenantId: string): Promise<void>;
  refreshAuthorization(): Promise<void>;
  reconcileSession(): Promise<void>;
}

declare global {
  interface Window {
    __sessionRecoveryHarness: SessionRecoveryHarness;
    __sessionRecoveryLoader: RouteAuthorizationBoundary;
  }
}

const PAINTS_KEY = '__zero_test_session_recovery_paints';
const RECOVERY_PAINTS_KEY = '__zero_test_session_recovery_alerts';
let recoveryVisible = false;
new MutationObserver(() => {
  const visible = Boolean(document.querySelector('[data-zero-auth-recovery]'));
  if (visible && !recoveryVisible) {
    window.sessionStorage.setItem(RECOVERY_PAINTS_KEY,
      String(Number(window.sessionStorage.getItem(RECOVERY_PAINTS_KEY) ?? 0) + 1));
  }
  recoveryVisible = visible;
}).observe(document.documentElement, { childList: true, subtree: true });
const client = createClient({
  url: window.location.origin,
  tables: {},
  auth: true,
  autoConnect: false,
}) as InternalClient;
let probeCalls = 0, probeAborts = 0;
const probeCompletions: (() => void)[] = [];
const probeBoundary = { revision: 1, subscribe: () => () => {} };
function renderHintProbe() {
  const auth = {
    authorizationScopeKey: 'same-probe-family', user: { userId: 'same-probe-user' }, activeTenant: null,
    sessionTransition: { revision: 0 },
    refreshAuthorization(signal: AbortSignal) {
      probeCalls++;
      signal.addEventListener('abort', () => { probeAborts++; }, { once: true });
      // Deliberately ignore cancellation: old completion must not reset the
      // replacement client's pending state or produce a current-scope error.
      return new Promise<null>((resolve) => { probeCompletions.push(() => resolve(null)); });
    },
  } as unknown as AuthClient;
  rootInstance.render(<AuthorizationHintRecovery auth={auth} dataBoundary={probeBoundary} checking={false} />);
}

function paints(): SessionRecoveryPaint[] {
  return JSON.parse(window.sessionStorage.getItem(PAINTS_KEY) ?? '[]');
}

window.__sessionRecoveryHarness = {
  snapshot: () => ({
    userId: client.auth?.user?.userId ?? null,
    hasRecoverableSession: client.auth?.hasRecoverableSession ?? false,
    isRestoring: client.auth?.isRestoring ?? false,
    isLoading: client.auth?.isLoading ?? false,
    transitionPhase: client.auth?.sessionTransition.phase ?? 'idle',
    tenantId: client.auth?.activeTenant?.tenantId ?? null,
    authorizationStatus: client.authorizationState.status,
  }),
  paints,
  recoveryPaintCount: () => Number(window.sessionStorage.getItem(RECOVERY_PAINTS_KEY) ?? 0),
  invalidateAuthorizationData() {
    client.auth!.invalidateAuthorization();
    // AuthClient and transport fencing are independently qualified in SDK
    // tests. This fixture drives their exact guard-visible boundary states.
    (client._authorizationDataBoundary as unknown as { invalidate(): void }).invalidate();
  },
  unmountProvider() { rootInstance.unmount(); },
  hintRetryClientProbe(action) {
    if (action === 'mount' || action === 'replace') renderHintProbe();
    if (action === 'finish-old') probeCompletions[0]?.();
    return { calls: probeCalls, aborted: probeAborts };
  },
  async login(username, password = 'synthetic-password') {
    await client.auth!.login(username, password);
  },
  async logout() { await client.auth!.logout(); },
  async switchTenant(tenantId) {
    await client.auth!.switchTenant(tenantId);
  },
  async refreshAuthorization() {
    await client.refreshAuthorization();
  },
  async reconcileSession() {
    try { await client.auth!.reconcileSession(); } catch { /* The test inspects the public retry state. */ }
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
const rootInstance = createRoot(root);
rootInstance.render(
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
