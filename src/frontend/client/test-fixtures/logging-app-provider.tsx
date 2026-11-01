/** Real AppProvider/SDK with a synthetic account supplied by the browser test. */
import { createRoot } from 'react-dom/client';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { AppProvider } from '../app-provider';
import { useAuth } from '../auth-hooks';
import { getClient, type InternalClient } from '../sdk';
import { UserProfileSettings } from '../../../components/profile-settings/user-profile-settings';
import { LoggingWorkspace } from '../../../components/logging/logging-workspace';
import { TooltipProvider } from '../../../components/tooltip';
import { AppShell } from '../../../components/app-shell';
import { useUserAvatar } from '../user-avatar-hooks';
import { UserDetailHeader } from '../../../components/admin/users/user-detail-header';
import { mapAuthUserToManagementUser } from '../../../components/admin/users/user-management-mappers';

Object.assign(window, { __loggingBrowserStatus: () => {
  const client = getClient() as InternalClient | null;
  return { authenticated: client?.auth?.isAuthenticated, authorizationStatus: client?.auth?.authorizationState.status,
    isRestoring: client?.auth?.isRestoring, phase: client?.auth?.sessionTransition.phase, dataRevision: client?._authorizationDataBoundary.revision };
} });
Object.assign(window, {
  __loggingNativeHealth: () => getClient()!.logging.health(),
  __loggingNativeAvatar: () => getClient()!.userAvatar,
  async __loggingNativeReadiness() {
    const client = getClient() as InternalClient, config = await client.auth!.getConfig();
    const value = await client.userProfile.get().then(snapshot => ({ profileCapabilityState: snapshot.capabilities.state }), error => ({ profileCode: error?.code }));
    return { profileState: config.userProfile?.state, avatarState: config.userProfile?.avatars?.state, avatarEnabled: config.userProfile?.avatars?.enabled, ...value };
  },
});

function Content() {
  const auth = useAuth(), [failed, setFailed] = useState(false);
  const [view, setView] = useState<'none' | 'profile' | 'audit'>('none');
  return auth.isAuthenticated ? <AvatarShell><main data-testid="logging-protected">Protected audit fixture
    <aside aria-label="Selected account" data-testid="native-user-details">
      <UserDetailHeader user={mapAuthUserToManagementUser(auth.user!)} roleLabel="Admin" />
    </aside>
    <nav aria-label="Synthetic native account controls"><button type="button" onClick={() => setView('profile')}>Show profile</button><button type="button" onClick={() => setView('audit')}>Show audit</button></nav>
    {view === 'profile' && <UserProfileSettings security={false} contacts={false} presence={false} additionalProperties={false} />}
    {view === 'audit' && <LoggingWorkspace allowExport={false} />}
  </main></AvatarShell>
    : <main><button type="button" onClick={() => { void auth.login('logging-browser-owner', 'Fixture-password-123!').catch(() => setFailed(true)); }}>Sign in fixture</button>
      {failed ? <p role="alert">Fixture sign in failed</p> : null}</main>;
}
/** An independent persistent hook owns the native footer, not the editor's local result or an onAccepted callback. */
function AvatarShell({ children }: { children: ReactNode }) {
  const avatar = useUserAvatar(), instance = useRef(crypto.randomUUID());
  useEffect(() => {
    const refresh = () => avatar.refresh();
    Object.assign(window, { __refreshNativeSidebarAvatar: refresh });
    return () => { delete (window as unknown as { __refreshNativeSidebarAvatar?: unknown }).__refreshNativeSidebarAvatar; };
  }, [avatar.refresh]);
  return <div data-testid="native-avatar-shell" data-instance={instance.current}>
    <AppShell header={false} contentMode="document" brand={{ name: 'Avatar fixture' }}
      user={{ name: 'Native avatar owner', avatar: avatar.imageUrl ?? undefined }}>{children}</AppShell>
  </div>;
}
createRoot(document.getElementById('root')!).render(<AppProvider url={location.origin} tables={{}} auth presence={false}
  publicPaths={['/logging-ui']} routeAuth="protected-by-default" initialPathname="/logging-ui"><TooltipProvider><Content /></TooltipProvider></AppProvider>);
