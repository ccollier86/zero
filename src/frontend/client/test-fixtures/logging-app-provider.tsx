/** Real AppProvider/SDK with a synthetic account supplied by the browser test. */
import { createRoot } from 'react-dom/client';
import { useState } from 'react';
import { AppProvider } from '../app-provider';
import { useAuth } from '../auth-hooks';
import { getClient, type InternalClient } from '../sdk';

Object.assign(window, { __loggingBrowserStatus: () => {
  const client = getClient() as InternalClient | null;
  return { authenticated: client?.auth?.isAuthenticated, authorizationStatus: client?.auth?.authorizationState.status,
    isRestoring: client?.auth?.isRestoring, phase: client?.auth?.sessionTransition.phase, dataRevision: client?._authorizationDataBoundary.revision };
} });

function Content() {
  const auth = useAuth(), [failed, setFailed] = useState(false);
  return auth.isAuthenticated ? <main data-testid="logging-protected">Protected audit fixture</main>
    : <main><button type="button" onClick={() => { void auth.login('logging-browser-owner', 'Fixture-password-123!').catch(() => setFailed(true)); }}>Sign in fixture</button>
      {failed ? <p role="alert">Fixture sign in failed</p> : null}</main>;
}
createRoot(document.getElementById('root')!).render(<AppProvider url={location.origin} tables={{}} auth presence={false}
  publicPaths={['/logging-ui']} routeAuth="protected-by-default" initialPathname="/logging-ui"><Content /></AppProvider>);
