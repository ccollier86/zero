/** Actual Client/AuthClient/form over the browser test's isolated Guardian HTTP server. */
import { createRoot } from 'react-dom/client';
import { ClientProvider } from '../../frontend/client/client-context';
import { createClient, type InternalClient } from '../../frontend/client/sdk';
import { useAuth } from '../../frontend/client/auth-hooks';
import { configureFrontendObservability } from '../../frontend/client/observability';
import { ProfileCompletionForm } from './profile-completion-form';
const client = createClient({ url: window.location.origin, tables: {}, auth: true, autoConnect: false }) as InternalClient;
const observations: string[] = [];
let successes = 0;
configureFrontendObservability({ sink: { emit(event) { observations.push(event.code ?? 'unknown'); } } });
const harness = {
  async start(username = 'completion-a') { await client.auth!.register({ username, email: `${username}@example.test`, password: 'password123' }); },
  snapshot() { return { userId: client.auth?.user?.userId ?? null, authenticated: client.auth?.isAuthenticated ?? false,
    recoverable: client.auth?.hasRecoverableSession ?? false, error: client.auth?.error ?? null,
    continuationUser: client.auth?.authenticationContinuation?.user.userId ?? null, successes, observations }; },
};
declare global { interface Window { __profileCompletionBrowser: typeof harness } }
window.__profileCompletionBrowser = harness;
function Content() {
  const auth = useAuth();
  if (auth.isAuthenticated) return <p data-testid="completed-session">Profile accepted for {auth.user?.firstName}</p>;
  return <ProfileCompletionForm onSuccess={() => { successes++; }} onBack={() => client.auth?.clearAuthenticationContinuation()} />;
}
createRoot(document.getElementById('root')!).render(<ClientProvider client={client}><Content /></ClientProvider>);
