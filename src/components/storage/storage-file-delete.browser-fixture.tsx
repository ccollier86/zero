/**
 * Isolated StorageManagement acceptance fixture. It uses the real SDK auth
 * client, storage hooks, and modal components against a disposable test server;
 * it never reads an app configuration or a pre-existing storage directory.
 */

import { createRoot } from 'react-dom/client';
import { createClient } from '../../frontend/client/sdk';
import { ClientProvider } from '../../frontend/client/client-context';
import { ModalManager } from '../../modals';
import { StorageManagement } from './storage-management';

interface FixtureConfig {
  readonly driveId: string;
  readonly username: string;
  readonly password: string;
}

async function mountFixture(): Promise<void> {
  const response = await fetch('/fixture-config');
  if (!response.ok) throw new Error('Disposable storage fixture configuration failed.');
  const config = await response.json() as FixtureConfig;
  const client = createClient({
    url: window.location.origin,
    auth: true,
    autoConnect: false,
    authorizationRevalidationIntervalMs: 0,
  });
  await client.login(config.username, config.password);
  createRoot(document.getElementById('root')!).render(
    <ClientProvider client={client}>
      <ModalManager>
        <StorageManagement initialDriveId={config.driveId} />
      </ModalManager>
    </ClientProvider>,
  );
}

void mountFixture().catch(() => {
  document.getElementById('root')!.textContent = 'Disposable storage fixture failed to start.';
});
