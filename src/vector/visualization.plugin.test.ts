/** Thin transport qualification uses synthetic Guardian authority and no provider/index calls. */
import { describe, expect, test } from 'bun:test';
import { createVectorVisualizationPlugin } from './visualization.plugin';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type { AuthContext } from '../auth/types';
import type { TokenService } from '../auth/token-service';
import type { ManagedVectorVisualization } from './visualization-managed';
import type { VectorVisualizationSnapshot } from './visualization-types';
const snapshot: VectorVisualizationSnapshot = { id: 'op:a', index: 'docs', kind: 'search', status: 'pending', revision: 1,
  createdAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:00:00Z', stages: [] };
function fixture() {
  const permissions = { 'knowledge:search': { label: 'Search', scope: 'application' as const }, 'knowledge:ingest': { label: 'Ingest', scope: 'application' as const } };
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({ authorization: { permissions,
    roles: { user: { permissions: ['knowledge:search'] }, ingester: { permissions: ['knowledge:ingest'] }, admin: { allPermissions: true } } } }));
  let current: AuthContext | null = { userId: 'user:a', email: 'user-a@example.test', role: 'user', sessionKind: 'web' };
  let effects = 0, disposal = 0, capturedScope: unknown = null, pending: (() => void) | null = null, cancelled = 0;
  const tokens = { resolveAuthContext: async (token: string) => token === 'valid' ? current : null,
    captureAuthContextAuthority: () => ({}), resolveAuthContextAuthority: () => current, assertCurrentProfile() {} } as unknown as TokenService;
  const owner = {
    scoped(_index: string, scope: unknown, owner: string, assertCurrent: () => void) {
      capturedScope = { scope, owner };
      return { async startSearch() { effects++; assertCurrent();
          if (pending) await new Promise<void>(resolve => { pending = resolve; });
          return { snapshot, completion: Promise.resolve({ ...snapshot, status: 'completed' }) }; },
        async startIngest() { effects++; assertCurrent(); return { snapshot: { ...snapshot, kind: 'ingestion' }, completion: Promise.resolve(snapshot) }; },
        async get(id: string) { assertCurrent(); return id === snapshot.id ? snapshot : null; },
        async cancel() { assertCurrent(); return { ...snapshot, status: 'cancelled', revision: 2 }; },
        async dispose() { disposal++; },
      };
    }, reserveStart() { return () => {}; }, retain() {}, abortAccepted() { cancelled++; },
  } as unknown as ManagedVectorVisualization;
  const app = createVectorVisualizationPlugin({ config: { defaultIndex: 'docs', indexes: { docs: { scopeField: 'corpus_scope', searchPermission: 'knowledge:search', ingestPermission: 'knowledge:ingest' } } },
    getService: () => owner, getTokenService: () => tokens, authorization: { getAuthorizationKernel: () => kernel } }).compile();
  return { app, get effects() { return effects; }, get disposal() { return disposal; }, get cancelled() { return cancelled; }, get capturedScope() { return capturedScope; },
    revoke() { current = null; }, native() { current = { ...current!, sessionKind: 'native' }; },
    ingestOnly() { current = { ...current!, role: 'ingester' }; },
    pause() { pending = () => {}; }, resume() { pending?.(); pending = null; } };
}
const request = (path: string, body?: unknown, token = 'valid') => new Request(`http://visualization.test/api/vector-visualizations${path}`, {
  headers: { authorization: `Bearer ${token}`, ...(body ? { 'content-type': 'application/json' } : {}) },
  ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
});
describe('vector visualization authorized transport', () => {
  test('accepts a permitted search with server scope and private no-store response', async () => {
    const f = fixture(); const response = await f.app.handle(request('/search', { text: 'Rotate my key' }));
    expect(response.status).toBe(202); expect((await response.json()).id).toBe(snapshot.id);
    expect(response.headers.get('cache-control')).toContain('no-store');
    expect(f.capturedScope).toMatchObject({ scope: { scopeKind: 'application', scopeId: 'application', tenantId: null }, owner: 'user:a' });
    expect(f.effects).toBe(1);
  });
  test('rejects anonymous/native users, forbidden ingestion and disabled indexes before effects', async () => {
    const f = fixture(); expect((await f.app.handle(request('/search', { text: 'Test' }, 'invalid'))).status).toBe(401);
    f.native(); expect((await f.app.handle(request('/search', { text: 'Test' }))).status).toBe(403);
    const other = fixture();
    expect((await other.app.handle(request('/ingest', { document: { id: 'doc', title: 'Doc', text: 'Contents' } }))).status).toBe(403);
    expect((await other.app.handle(request('/search', { text: 'Test', index: 'other' }))).status).toBe(403);
    expect(f.effects + other.effects).toBe(0);
  });
  test('does not accept forged query targets or duplicate index selectors', async () => {
    const f = fixture();
    for (const path of ['/op:a?tenantId=other', '/op:a?index=docs&index=other', '/search?scope=other']) {
      const response = await f.app.handle(request(path, path.startsWith('/search') ? { text: 'Test' } : undefined));
      expect(response.status).toBe(422);
    }
    expect(f.effects).toBe(0);
  });
  test('revalidates authority after accepted work yields before returning its snapshot', async () => {
    const f = fixture(); f.pause();
    const response = f.app.handle(request('/search', { text: 'Test' }));
    while (!f.effects) await Promise.resolve();
    f.revoke(); f.resume(); expect((await response).status).toBe(403);
  });
  test('only an authorized observed cancellation aborts accepted work', async () => {
    const f = fixture(); const response = await f.app.handle(new Request('http://visualization.test/api/vector-visualizations/op:a/cancel', { method: 'POST', headers: { authorization: 'Bearer valid' } }));
    expect(response.status).toBe(200); expect((await response.json()).status).toBe('cancelled');
    expect(f.cancelled).toBe(1); expect(f.disposal).toBe(1);
  });
  test('write-only ingestion cannot disclose existing corpus maps through visualized ingestion', async () => {
    const f = fixture(); f.ingestOnly();
    const response = await f.app.handle(request('/ingest', { document: { id: 'doc', title: 'Doc', text: 'Contents' } }));
    expect(response.status).toBe(403); expect(f.effects).toBe(0);
  });
});
