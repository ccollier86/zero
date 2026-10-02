/** Real AppProvider browser fixture for authorization-scope regression tests. */

import { createRoot } from 'react-dom/client';
import { AppProvider } from '../app-provider';
import { createClient, type InternalClient } from '../sdk';

const client = createClient({
  url: window.location.origin,
  tables: {},
  auth: true,
  autoConnect: false,
}) as InternalClient;

const harness = {
  resetSync(): void {
    client._syncClient.reset();
  },
  snapshot() {
    return {
      authorizationStatus: client.authorizationState.status,
      dataRevision: client._authorizationDataBoundary.revision,
      isAuthenticated: client.isAuthenticated,
      isRestoring: client.auth?.isRestoring ?? false,
    };
  },
};

Object.assign(window, { __appProviderAuthorizationHarness: harness });

function Login() {
  return (
    <form aria-label="Sign in">
      <label>
        Username
        <input name="username" />
      </label>
    </form>
  );
}

const root = document.getElementById('root');
if (!root) throw new Error('Authorization-scope browser fixture root is missing.');

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
    <Login />
  </AppProvider>,
);
