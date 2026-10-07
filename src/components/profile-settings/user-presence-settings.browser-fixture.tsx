/** Actual presence owner/hooks/controls over synthetic scoped receipts; no live accounts. */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import type { Client } from '../../frontend/client/sdk';
import { GuardianPresenceClient } from '../../frontend/client/guardian-presence-client';
import { useAvatarPresence, useGuardianPresence } from '../../frontend/client/guardian-presence-hooks';
import { readAuthorizationScopeBoundaryKey } from '../../frontend/client/authorization-scope-hooks';
import { AuthorizationDataBoundaryController } from '../../frontend/client/authorization-data-boundary';
import type { AuthClient } from '../../frontend/client/auth-client';
import type { AuthPresenceCapabilities, AuthPresenceIntent, UpdateAuthPresenceIntentInput } from '../../auth/auth-presence-types';
import { completionUser } from '../../frontend/client/auth-user-profile-completion.test-fixtures';
import { UserPresenceSettings } from './user-presence-settings';
import { AvatarGroup } from '../avatar-group';

const query = new URLSearchParams(location.search), listeners = new Set<() => void>(), data = new AuthorizationDataBoundaryController();
let scope = 'family-a', connected = true, user = completionUser(), readOnly = query.has('readonly'), enabled = !query.has('disabled');
let canSetIntent = !query.has('native'), starts = 0, ownReads = 0;
const failures: string[] = [], reports: unknown[] = [];
let intent: AuthPresenceIntent = { status: 'available', revision: 1, expiresAt: null };
const auth = { get user() { return user; }, activeTenant: { tenantId: 'org', kind: 'organization', slug: 'org', name: 'Organization', role: 'member' },
  get authorizationScopeKey() { return scope; }, isAuthenticated: true, isLoading: false, isRestoring: false,
  sessionTransition: { phase: 'idle', operation: null, revision: 0, recoverable: false, error: null },
  authorizationState: { status: 'ready', snapshot: null, error: null },
  subscribe(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
  subscribeAuthorization(callback: () => void) { listeners.add(callback); return () => listeners.delete(callback); },
  store: { getSnapshot: () => ({ context: { user, activeTenant: auth.activeTenant, isLoading: false, isRestoring: false, error: null,
    sessionTransition: auth.sessionTransition, authenticationContinuation: null } }) },
} as unknown as AuthClient;
const capabilities = (): AuthPresenceCapabilities => ({ enabled, state: enabled ? 'ready' : 'disabled', topology: 'single-owner',
  statuses: [{ key: 'available', label: 'Available', tone: 'success', selectable: true },
    { key: 'busy', label: 'Busy', tone: 'destructive', selectable: true }, { key: 'away', label: 'Away', tone: 'warning', selectable: true },
    { key: 'idle', label: 'Idle', tone: 'muted', selectable: false }, { key: 'offline', label: 'Offline', tone: 'muted', selectable: false },
    { key: 'on-call', label: 'On call', tone: 'primary', icon: 'radio', selectable: true }],
  heartbeatIntervalMs: 15_000, idleAfterMs: 300_000, awayAfterMs: 600_000, serverTime: Date.now(), ownerLeaseDurationMs: 60_000,
  canReportActivity: canSetIntent, canSetIntent });
let freshUntil = Date.now() + 50_000;
const snapshot = () => ({ capabilities: capabilities(), intent: structuredClone(intent), observation: null });
interface Receipt { input: UpdateAuthPresenceIntentInput; signal?: AbortSignal; resolve(response: Response): void }
const calls: Receipt[] = [], readSignals: AbortSignal[] = [];
const presence = new GuardianPresenceClient({ enabled: true,
  readBoundary: () => ({ key: readAuthorizationScopeBoundaryKey(auth, data.revision), ready: true, connected, scopeKind: 'tenant', scopeId: 'org' }),
  subscribeBoundary(callback) { listeners.add(callback); return () => listeners.delete(callback); },
  readRows: () => ({ rows: { own: { _pk: 'own', scope_kind: 'tenant', scope_id: 'org', user_id: user.userId,
    status_key: intent.status, connected: 1, revision: 1, owner_epoch: 1, updated_at: Date.now() } },
    owner: { _pk: 'primary', owner_key: 'primary', owner_epoch: 1, retired: 0, fresh_until: freshUntil } }),
  async authenticatedFetch(path, init) {
    if (path.endsWith('/config')) return Response.json(capabilities());
    if (init?.method === 'PATCH') return new Promise<Response>(resolve => calls.push({ input: JSON.parse(String(init.body)), signal: init.signal ?? undefined, resolve }));
    ownReads++; if (init?.signal) readSignals.push(init.signal);
    await new Promise(done => setTimeout(done, 20)); return Response.json(snapshot());
  }, sendTransient(value) { reports.push(value); return connected; }, reportFailure() { failures.push('presence.failure'); },
  activityEnvironment: query.has('default-env') ? undefined : { target: new EventTarget(), visibility: new EventTarget(), isVisible: () => true, now: Date.now,
    schedule(callback, delay) { starts++; return setInterval(callback, delay); }, cancel(timer) { clearInterval(timer); } },
});
const client = { auth, _authorizationDataBoundary: data, presence } as unknown as Client;
const notify = () => { for (const listener of listeners) listener(); };
const harness = {
  calls, readSignals, failures, reports, starts: () => starts, reads: () => ownReads, state: () => presence.getSnapshot(),
  setReadOnly: (_value: boolean) => {},
  async nativeReadOnly() { canSetIntent = false; await presence.refresh(); },
  async disabled() { enabled = false; await presence.refresh(); },
  resolve(index: number) { const call = calls[index]!; intent = { status: call.input.status, revision: call.input.expectedRevision + 1, expiresAt: null };
    call.resolve(Response.json(snapshot())); notify(); },
  reject(index: number) { calls[index]!.resolve(Response.json({ error: 'NEVER_RENDER_OR_LOG', code: 'SYNTHETIC_FAILURE' }, { status: 500 })); },
  replace(notifyNow = true) { scope = 'family-b'; user = completionUser('user-b'); intent = { status: 'available', revision: 10, expiresAt: null }; if (notifyNow) notify(); },
  notify, disconnect() { connected = false; notify(); }, reconnect() { connected = true; freshUntil = Date.now() + 50_000; notify(); },
  expire() { freshUntil = 0; notify(); }, expireSoon() { freshUntil = Date.now() + 200; notify(); }, dispose() { presence.dispose(); },
};
declare global { interface Window { __presenceSettings: typeof harness } }
window.__presenceSettings = harness;
function Avatars() {
  const own = useAvatarPresence(user.userId); useGuardianPresence();
  return <AvatarGroup shape="square" animated={false} presenceEnabled members={[{ id: user.userId, name: 'Synthetic user', presence: own }]} />;
}
function Fixture() {
  const [locked, setLocked] = useState(readOnly); harness.setReadOnly = value => { readOnly = value; setLocked(value); };
  const settings = <UserPresenceSettings readOnly={locked} />;
  return <ClientProvider client={client}>{query.has('standalone') ? settings : <div className="profile-settings">{settings}</div>}<Avatars /><Observer /></ClientProvider>;
}
function Observer() { const state = useGuardianPresence(); return <output data-testid="owner-status">{state.status}</output>; }
presence.activate();
async function mount() {
  // Mount settings against the already-started SDK owner, like an account
  // route opened after application initialization.
  while (presence.getSnapshot().status === 'loading') await new Promise(done => setTimeout(done, 0));
  createRoot(document.getElementById('root')!).render(<Fixture />);
}
void mount();
