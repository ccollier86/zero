/** Actual native forms, auth hooks and SDK transport. Only synthetic loopback/test-origin callers use this fixture. */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { flushSync } from 'react-dom';
import { ClientProvider } from '../../frontend/client/client-context';
import { createClient, getClient, type InternalClient } from '../../frontend/client/sdk';
import { AppProvider } from '../../frontend/client/app-provider';
import { readBrowserRouteAuthorizationBoundary } from '../../frontend/router/authorization-route-boundary';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { PasswordActionForm } from './password-action-form';
import { ForgotPasswordForm } from './forgot-password-form';

const observations: unknown[] = [];
let successes = 0, failCallback = false;
configureFrontendObservability({ console: false, http: false, sink: { emit(event) { observations.push(event); } } });
const makeClient = () => createClient({ url: window.location.origin, auth: true, tables: {}, autoConnect: Boolean(window.__passwordNativeProvider), authorizationRevalidationIntervalMs: 0 });
const initial = new URL(window.location.href);
const harness = { observations, get successes() { return successes; },
  replaceToken: (_token: string, _mode?: 'auto' | 'reset' | 'setup') => {},
  replaceClient: () => {}, hide: () => {}, throwOnSuccess() { failCallback = true; },
  async signIn(username: string, password: string) { await getClient()!.login(username, password); },
  freezeHydratedDocument() {
    const auth = (getClient()! as InternalClient).auth!;
    Object.assign(window, { __ROUTE_DATA__: { authorizationBoundary: {
      ...readBrowserRouteAuthorizationBoundary(auth),
      scopeRevision: auth.authorizationState.snapshot?.scope?.revision ?? null,
      authorizationReady: auth.authorizationState.status === 'ready',
    } } });
  },
};
declare global { interface Window { __passwordForm: typeof harness; __passwordNativeProvider?: boolean } }
window.__passwordForm = harness;
function Fixture() {
  const [client, setClient] = React.useState(makeClient);
  const [generation, setGeneration] = React.useState(0);
  const [token, setToken] = React.useState(initial.searchParams.get('token') ?? '');
  const [mode, setMode] = React.useState<'auto' | 'reset' | 'setup'>(initial.pathname.includes('setup') ? 'setup' : 'reset');
  const [visible, setVisible] = React.useState(true);
  harness.replaceToken = (next, nextMode) => flushSync(() => { setToken(next); if (nextMode) setMode(nextMode); });
  harness.replaceClient = () => {
    flushSync(() => setVisible(false));
    client.disconnect();
    flushSync(() => { setClient(makeClient()); setGeneration(value => value + 1); setVisible(true); });
  };
  harness.hide = () => flushSync(() => setVisible(false));
  const content = visible && (initial.pathname.includes('forgot')
    ? <ForgotPasswordForm loginHref="/login" />
    : <PasswordActionForm token={token} mode={mode} loginHref="/login" forgotPasswordHref="/forgot-password" onSuccess={() => {
      successes++; if (failCallback) throw new Error('PRIVATE_NOTIFICATION_ERROR');
    }} />);
  return window.__passwordNativeProvider
    ? <AppProvider url={window.location.origin} tables={{}} auth presence={false} initialPathname={initial.pathname}
        publicPaths={['/reset-password', '/setup-password', '/forgot-password', '/login']}>{content}</AppProvider>
    : <ClientProvider key={generation} client={client}>{content}</ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
