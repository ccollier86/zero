/** Real native workspace and account lifecycle; synthetic local identities only. */
import { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '../../frontend/client/app-provider';
import { createClient } from '../../frontend/client/sdk';
import { useClient } from '../../frontend/client/client-context';
import { useAuth } from '../../frontend/client/auth-hooks';
import { MessagingWorkspace } from './messaging-workspace';

function AccountControls() {
  const client = useClient(), auth = useAuth(), [failure, setFailure] = useState(false);
  const login = async (username: string) => {
    try { setFailure(false); await client.login(username, 'Synthetic-private-avatar-password-123'); }
    catch { setFailure(true); }
  };
  return <div><span data-testid="avatar-account">{auth.user?.username ?? 'signed-out'}</span>
    <button onClick={() => { void login('avatar-viewer'); }}>Switch to viewer</button>
    <button onClick={() => { void login('avatar-staff'); }}>Switch to staff</button>
    <button onClick={() => { void client.logout(); }}>Sign out test account</button>
    {failure && <span role="alert">Synthetic account switch failed</span>}</div>;
}

async function mount() {
  const client = createClient({ url: location.origin, auth: true, autoConnect: false });
  await client.login('avatar-viewer', 'Synthetic-private-avatar-password-123');
  client.connect();
  createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider url={location.origin} tables={{}} auth>
    <AccountControls /><MessagingWorkspace readPolicy="manual" />
  </AppProvider></StrictMode>);
}
void mount().catch(() => { document.getElementById('root')!.textContent = 'Synthetic avatar workspace could not start.'; });
