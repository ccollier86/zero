/** Disposable native Guardian/HTTP/SDK/Fabric fixture. No credentials, authority or app data are imported. */
import { mkdtemp, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from '../../frontend/server/app-factory';
import type { AppConfig } from '../../frontend/server/types';
import { createMessagingClient } from '../../frontend/client/messaging-client';
import type { FetchInit } from '../../frontend/client/sdk';

export const PORTAL_PASSWORD = 'Synthetic-portal-password-123';
export async function portalFixture(overrides: Pick<Partial<AppConfig>, 'messaging' | 'auth' | 'ai' | 'workflows'> = {}) {
  const root = await mkdtemp(join(tmpdir(), 'zero-portal-')); await mkdir(join(root, 'app'));
  const config: AppConfig = { projectRoot: root, db: { mode: 'file', path: join(root, 'app.db') }, systemDb: { mode: 'file', path: join(root, 'system.db') }, tables: {},
    auth: { bootstrap: 'public' }, messaging: { portal: true }, logging: false,
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'), storageDir: join(root, 'storage'),
    themeFoundation: 'legacy', frontendBuild: { version: 1, frontend: { themeFoundation: 'legacy', plugins: {} }, pluginIdentities: {} },
    workflows: false, email: false, ai: false, vector: false, pdf: false, kv: false, stateSync: false, observability: false,
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false, ...overrides };
  const reservation = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response(null, { status: 503 }) }), port = reservation.port!;
  let app: Awaited<ReturnType<typeof createApp>>, origin = '';
  try { app = await createApp(config); } catch (error) { await reservation.stop(true); throw error; }
  await reservation.stop(true);
  const listen = () => { app.listen({ hostname: '127.0.0.1', port }); origin = 'http://127.0.0.1:' + port; };
  try { listen(); } catch (error) { await app.stop(true); throw error; }
  const peers: Array<{ close(): void }> = [];
  return { get origin() { return origin; }, config,
    peer() {
      let token: string | null = null, id = '';
      const request = async (path: string, init: FetchInit = {}) => {
        const headers = new Headers(init.headers as HeadersInit); if (token) headers.set('Authorization', 'Bearer ' + token);
        if (init.body !== undefined) headers.set('Content-Type', 'application/json');
        return fetch(origin + path, { method: init.method, headers, signal: init.signal, ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }) });
      };
      const json = async <T = any>(path: string, init: FetchInit = {}): Promise<T> => {
        const response = await request(path, init);
        if (!response.ok) { const error = await response.json() as { code?: string }; throw Object.assign(new Error('Synthetic portal request rejected.'), {
          status: response.status, code: error.code, operation: new Headers(init.headers as HeadersInit).get('Idempotency-Key') ?? init.method ?? 'GET',
        }); }
        return init.json === false ? response as T : await response.json() as T;
      };
      const messaging = createMessagingClient(json, async (path, init) => { const headers = new Headers(init.headers); if (token) headers.set('Authorization', 'Bearer ' + token); return fetch(origin + path, { ...init, headers }); });
      const account = { messaging, json, request, get id() { return id; },
        async register(name: string, extra: object = {}) { const result = await json('/auth/register', { method: 'POST', body: { username: name, email: name + '@example.test', password: PORTAL_PASSWORD, ...extra } }); token = result.accessToken; id = result.user.userId; return result; },
        async acceptInvitation(name: string, invitation: string) { const result = await json('/auth/invitations/accept', { method: 'POST', body: { token: invitation, username: name, email: name + '@example.test', password: PORTAL_PASSWORD } }); token = result.accessToken; id = result.user.userId; return result; },
        async login(name: string) { const result = await json('/auth/login', { method: 'POST', body: { username: name, password: PORTAL_PASSWORD } }); token = result.accessToken; id = result.user.userId; return result; },
        close() { messaging.clear(); token = null; } };
      peers.push(account); return account;
    },
    async restart() { await app.stop(true); app = await createApp(config); listen(); },
    async close() { peers.forEach(peer => peer.close()); await app.stop(true); } };
}
