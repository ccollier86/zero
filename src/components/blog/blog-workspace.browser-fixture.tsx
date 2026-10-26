/** Isolated synthetic-account UI fixture. This is never a managed production route or real account configuration. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '../../frontend/client/sdk';
import { ClientProvider } from '../../frontend/client/client-context';
import { BlogWorkspace } from './blog-workspace';
import { ModalManager } from '../../modals/modal-manager';
const client = createClient({ url: window.location.origin, auth: true, autoConnect: false });
function Fixture() {
  const [ready, setReady] = React.useState(false), [error, setError] = React.useState(false);
  return <ClientProvider client={client}><ModalManager recedeSurface={false}>{ready ? <BlogWorkspace /> : <div><button type="button" onClick={() => {
    void client.login('workspace-writer', 'Synthetic-workspace-password-123').then(() => setReady(true)).catch(() => setError(true));
  }}>Open synthetic author workspace</button>{error && <p role="alert">Synthetic login failed.</p>}</div>}</ModalManager></ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
