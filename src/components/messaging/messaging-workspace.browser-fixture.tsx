/** Actual public AppProvider/SDK/Sync/typing path over an isolated native Zero server. Synthetic identities only. */
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider } from '../../frontend/client/app-provider';
import { createClient } from '../../frontend/client/sdk';
import { MessagingWorkspace } from './messaging-workspace';
import { SupportChat } from './support-chat';
async function mount() {
  const query = new URLSearchParams(location.search);
  if (location.pathname === '/support') { createRoot(document.getElementById('root')!).render(<StrictMode><SupportChat entry="website" mode="human" /></StrictMode>); return; }
  const client = createClient({ url: location.origin, auth: true, presence: true, autoConnect: false });
  await client.login(query.get('user') === 'peer' ? 'workspace-peer' : 'workspace-admin', 'Synthetic-workspace-password-123');
  client.connect();
  createRoot(document.getElementById('root')!).render(<StrictMode><AppProvider url={location.origin} tables={{}} auth>
    <MessagingWorkspace avatarShape="square" readPolicy={query.has('manual') ? 'manual' : 'visible-end'} />
  </AppProvider></StrictMode>);
}
void mount().catch(() => { document.getElementById('root')!.textContent = 'Synthetic workspace could not start.'; });
