'use client';
import { LoggingWorkspace } from '@zero/framework/components/logging';
import { useAuth, useClient } from '@zero/framework/react';

export const config = { auth: 'admin' };
export const meta = { title: 'Synthetic audit workspace' };
export function loader({ auth }: { auth: { userId: string } | null }) { return { viewer: auth?.userId ?? null }; }

export default function WorkspacePage({ data }: { data?: { viewer: string | null } }) {
  const auth = useAuth(), client = useClient();
  return <main data-testid="session-audit-workspace" data-server-viewer={data?.viewer ?? ''} data-browser-viewer={auth.user?.userId ?? ''}>
    <h1>Synthetic audit workspace</h1>
    <button type="button" onClick={() => { void auth.logout(); }}>Sign out fixture</button>
    <button type="button" onClick={() => { void client.post('/proof/record', {}); }}>Record synthetic activity</button>
    <button type="button" onClick={() => { void Promise.all(Array.from({ length: 30 }, () => client.post('/proof/record', {}))); }}>Record synthetic burst</button>
    <LoggingWorkspace initialQuery={{ action: 'fixture.audit.prepared' }} />
  </main>;
}
