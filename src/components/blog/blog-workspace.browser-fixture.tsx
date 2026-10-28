/** Isolated synthetic-account UI fixture. This is never a managed production route or real account configuration. */
import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { createClient } from '../../frontend/client/sdk';
import { ClientProvider } from '../../frontend/client/client-context';
import { BlogWorkspace } from './blog-workspace';
import { ModalManager } from '../../modals/modal-manager';
// Fault injection at the browser's transport boundary, not a replacement authoring service.
// Healthy frames still come from the real managed server and its native facade.
const originalFetch = window.fetch.bind(window);
let interrupt: (() => void) | undefined, blocked = false;
const faultFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(input instanceof Request ? input.url : String(input), location.href);
  if (url.pathname !== '/api/blog/live') return originalFetch(input, init);
  if (blocked) return new Response(null, { status: 503 });
  const response = await originalFetch(input, init);
  if (!response.body || !response.ok) return response;
  let owned: (() => void) | undefined;
  const stream = new TransformStream<Uint8Array, Uint8Array>({ start(controller) {
    owned = () => { blocked = true; controller.enqueue(new TextEncoder().encode('data: {"version":1,"error":true}\n\n')); };
    interrupt = owned;
  }, transform(chunk, controller) { controller.enqueue(chunk); }, flush() { if (interrupt === owned) interrupt = undefined; } });
  return new Response(response.body.pipeThrough(stream), { headers: response.headers, status: response.status });
};
window.fetch = Object.assign(faultFetch, { preconnect: window.fetch.preconnect });
const client = createClient({ url: window.location.origin, auth: true, autoConnect: false });
function Fixture() {
  const [ready, setReady] = React.useState(false), [error, setError] = React.useState(false);
  return <ClientProvider client={client}><ModalManager recedeSurface={false}>{ready ? <><nav aria-label="Synthetic recovery controls"><button type="button" onClick={() => interrupt?.()}>Interrupt synthetic publishing stream</button>
    <button type="button" onClick={() => { blocked = false; }}>Restore synthetic publishing transport</button></nav><BlogWorkspace /></> : <div><button type="button" onClick={() => {
    void client.login('workspace-writer', 'Synthetic-workspace-password-123').then(() => setReady(true)).catch(() => setError(true));
  }}>Open synthetic author workspace</button>{error && <p role="alert">Synthetic login failed.</p>}</div>}</ModalManager></ClientProvider>;
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>);
