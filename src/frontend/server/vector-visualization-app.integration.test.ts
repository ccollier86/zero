/** Managed HTTP + SYSTEM Sync proof. All models/SQL/native collections are disposable fixtures. */
import { afterEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { ProviderV4 } from '@ai-sdk/provider';
import { MockEmbeddingModelV4 } from 'ai/test';
import { createPlatformSQLiteService, type PlatformSQLiteService } from '../../persistence';
import type { ServerMessage } from '../../sync/types';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE } from '../../vector/visualization-schema';
import type { VectorVisualizationSnapshot } from '../../vector/visualization-types';
import { createApp } from './app-factory';

type App = Awaited<ReturnType<typeof createApp>>;
const apps: App[] = [], sql: PlatformSQLiteService[] = [], roots: string[] = [], sockets: WebSocket[] = [];
afterEach(async () => {
  await Promise.all(sockets.splice(0).map(closeSocket));
  for (const app of apps.splice(0).reverse()) await app.stop(true);
  for (const sqlite of sql.splice(0)) sqlite.close();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});
async function setup(enabled: boolean) {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true }); const root = await mkdtemp(join(scratch, 'vector-managed-app-')); roots.push(root);
  await mkdir(join(root, 'app'));
  const application = createPlatformSQLiteService({ mode: 'ephemeral' }), system = createPlatformSQLiteService({ mode: 'ephemeral' }); sql.push(application, system);
  const embedding = new MockEmbeddingModelV4({ maxEmbeddingsPerCall: 16, supportsParallelCalls: true,
    doEmbed: async ({ values }) => ({ embeddings: values.map(value => value.includes('lexical document') ? [-1, 0, 0] : [1, 0, 0]), usage: { tokens: values.length }, warnings: [] }) });
  const adapter: ProviderV4 = { specificationVersion: 'v4', embeddingModel: () => embedding,
    languageModel: () => { throw new Error('Fixture cannot invoke a language provider'); },
    imageModel: () => { throw new Error('Fixture cannot invoke an image provider'); } };
  const app = await createApp({
    db: { sqlite: application }, systemDb: { sqlite: system }, tables: { app_records: { id: 'TEXT PRIMARY KEY', title: 'TEXT NOT NULL' } },
    auth: enabled ? { bootstrap: 'public', registration: { mode: 'public' }, tenancy: 'single', authorization: {
      mode: 'simple', permissions: { 'documents:search': { label: 'Search documents' }, 'documents:ingest': { label: 'Ingest documents' } },
      roles: {
        // Public bootstrap creates the first global admin; simple-profile
        // application authority still requires its explicitly declared role.
        admin: { permissions: ['documents:search', 'documents:ingest'] },
        user: { permissions: ['documents:search', 'documents:ingest'] },
      },
    } } : false,
    ai: enabled ? { autoDetect: false, providers: { fixture: { type: 'custom', adapter, capabilities: { embeddings: true } } }, aliases: { embedding: 'fixture/embedding-three' } } : false,
    vector: enabled ? { defaultIndex: 'docs', indexes: { docs: { dimensions: 3, lexical: true, indexType: 'flat', path: join(root, 'corpus'), metadata: { corpus_scope: 'string' } } } } : false,
    vectorVisualization: enabled ? { defaultIndex: 'docs', indexes: { docs: { scopeField: 'corpus_scope', searchPermission: 'documents:search', ingestPermission: 'documents:ingest', embeddingModel: 'embedding',
      metadataFields: ['title', 'source_label'], chunk: { maxChars: 1000, maxTokens: 256, overlapChars: 120 } } } } : false,
    appDir: join(root, 'app'), outDir: join(root, 'out'), generatedDir: join(root, 'generated'),
    serverResourcesDir: false, serverPluginsDir: false, serverMiddlewareDir: false, serverEndpointsDir: false, serverRoutesDir: false,
    resourceRoutes: false, workflows: false, observability: false, email: false, pdf: false, kv: false, migrate: false,
  }); apps.push(app); app.listen(0);
  return { app, root, application, system, embedding, base: `http://localhost:${app.server!.port}`, ws: `ws://localhost:${app.server!.port}/sync` };
}
async function register(base: string, label: string) {
  const response = await fetch(`${base}/auth/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: `${label}-${crypto.randomUUID()}`, email: `${label}-${crypto.randomUUID()}@example.test`, password: 'password123' }) });
  expect(response.status).toBe(200);
  return response.json() as Promise<{ accessToken: string; user: { userId: string } }>;
}
async function request(base: string, token: string, path: string, body?: unknown) {
  const response = await fetch(`${base}${path}`, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: response.status, headers: response.headers, body: await response.json() as VectorVisualizationSnapshot | null };
}
async function complete(base: string, token: string, id: string): Promise<VectorVisualizationSnapshot> {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    const current = await request(base, token, `/api/vector-visualizations/${encodeURIComponent(id)}?index=docs`);
    expect(current.status).toBe(200);
    if (current.body && ['completed', 'failed', 'cancelled', 'interrupted'].includes(current.body.status)) return current.body;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Managed fixture operation did not settle');
}
async function connect(url: string, token: string) {
  const socket = new WebSocket(url); sockets.push(socket);
  const messages: ServerMessage[] = [];
  const waiters = new Set<{ predicate: (message: ServerMessage) => boolean; resolve: (message: ServerMessage) => void }>();
  socket.addEventListener('message', event => {
    const message = JSON.parse(String(event.data)) as ServerMessage; messages.push(message);
    for (const waiter of [...waiters]) if (waiter.predicate(message)) { waiters.delete(waiter); waiter.resolve(message); }
  });
  const wait = (predicate: (message: ServerMessage) => boolean): Promise<ServerMessage> => {
    const existing = messages.find(predicate); if (existing) return Promise.resolve(existing);
    return new Promise((resolve, reject) => {
      const entry = { predicate, resolve: (message: ServerMessage) => { clearTimeout(timer); resolve(message); } };
      const timer = setTimeout(() => { waiters.delete(entry); reject(new Error('Managed Sync fixture timed out')); }, 8_000);
      waiters.add(entry);
    });
  };
  await new Promise<void>((resolve, reject) => { socket.addEventListener('open', () => resolve(), { once: true }); socket.addEventListener('error', () => reject(new Error('Fixture socket failed')), { once: true }); });
  socket.send(JSON.stringify({ type: 'sync.auth', token }));
  expect(await wait(message => message.type === 'sync.auth.ready')).toMatchObject({ authenticated: true });
  return { socket, messages, wait };
}
function closeSocket(socket: WebSocket): Promise<void> {
  if (socket.readyState === WebSocket.CLOSED) return Promise.resolve();
  return new Promise(resolve => { const timer = setTimeout(resolve, 1000); socket.addEventListener('close', () => { clearTimeout(timer); resolve(); }, { once: true }); socket.close(); });
}
function hasTable(sqlite: PlatformSQLiteService, name: string): boolean { return Boolean(sqlite.raw.query("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name)); }

describe('managed vector visualizations in createApp', () => {
  it('feature off creates neither operation nor private projection tables in either plane', async () => {
    const f = await setup(false);
    for (const sqlite of [f.application, f.system]) for (const table of [VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_FEED_TABLE]) expect(hasTable(sqlite, table)).toBe(false);
    expect(f.embedding.doEmbedCalls).toHaveLength(0);
  }, 60_000);
  it('real accepted ingest/search stages are owner-scoped HTTP and SYSTEM reactive data, not simulated animation state', async () => {
    const f = await setup(true);
    expect(hasTable(f.application, VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe(false);
    expect(hasTable(f.system, VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe(true);
    expect(hasTable(f.system, VECTOR_VISUALIZATION_MAPS_TABLE)).toBe(true);
    expect(hasTable(f.application, VECTOR_VISUALIZATION_FEED_TABLE)).toBe(false);
    expect(hasTable(f.system, VECTOR_VISUALIZATION_FEED_TABLE)).toBe(true);
    const owner = await register(f.base, 'owner'), outsider = await register(f.base, 'outsider');
    const chunkIds: string[] = [];
    for (const document of [ { id: 'dense', title: 'Dense document', text: 'Semantically related ordinary document' },
      { id: 'lexical', title: 'Literal document', text: 'uniquemarker lexical document about something else' } ]) {
      const accepted = await request(f.base, owner.accessToken, '/api/vector-visualizations/ingest', { index: 'docs', document });
      expect({ status: accepted.status, body: accepted.body }).toMatchObject({ status: 202, body: { kind: 'ingestion' } }); expect(accepted.headers.get('Cache-Control')).toContain('no-store');
      expect(accepted.body?.kind).toBe('ingestion');
      const finished = await complete(f.base, owner.accessToken, accepted.body!.id);
      expect({ status: finished.status, error: finished.error, stages: finished.stages }).toMatchObject({ status: 'completed' }); expect(finished.ingestion?.completedChunks).toBe(1);
      expect(finished.ingestion?.chunks[0]).toMatchObject({ text: document.text, status: 'completed', dimensions: 3, tokenCountApproximate: true });
      expect(finished.ingestion?.chunks[0]?.storedAt).toEqual(expect.any(String)); chunkIds.push(finished.ingestion!.chunks[0]!.id);
    }
    const searches: VectorVisualizationSnapshot[] = [];
    for (const retrieval of ['vector', 'hybrid'] as const) {
      const accepted = await request(f.base, owner.accessToken, '/api/vector-visualizations/search', { index: 'docs', text: 'uniquemarker', retrieval, topK: retrieval === 'vector' ? 1 : 2, candidateCount: 2 });
      expect(accepted.status).toBe(202);
      const finished = await complete(f.base, owner.accessToken, accepted.body!.id); searches.push(finished);
      expect({ status: finished.status, error: finished.error, stages: finished.stages, retrieval }).toMatchObject({ status: 'completed' }); expect(finished.query?.dimensions).toBe(3);
      expect(finished.map?.capabilities).toMatchObject({ nativeTraversal: false, graph: 'derived-neighbors' });
      expect(finished.trace).toBeUndefined();
    }
    expect(searches[0]!.results?.map(row => row.id)).toEqual([chunkIds[0]!]);
    expect(new Set(searches[1]!.results?.map(row => row.id))).toEqual(new Set(chunkIds));
    expect(searches[1]!.results?.every(row => row.score.kind === 'fusion')).toBe(true);
    expect(searches[1]!.stages.find(stage => stage.id === 'lexical')?.status).toBe('completed');
    const points = searches[1]!.map!.points;
    expect(new Set(points.map(point => point.id))).toEqual(new Set(chunkIds));
    expect(new Set(points.map(point => `${point.position.x},${point.position.y}`)).size).toBe(2);
    expect(searches[0]!.map!.projectionId).toBe(searches[1]!.map!.projectionId);
    expect(f.embedding.doEmbedCalls.length).toBeGreaterThanOrEqual(4);
    const hidden = await request(f.base, outsider.accessToken, `/api/vector-visualizations/${searches[0]!.id}?index=docs`);
    expect(hidden.status).toBe(200); expect(hidden.body).toBeNull();
    const ownerSync = await connect(f.ws, owner.accessToken), outsiderSync = await connect(f.ws, outsider.accessToken);
    for (const connection of [ownerSync, outsiderSync]) connection.socket.send(JSON.stringify({ type: 'sync.subscribe',
      tables: [VECTOR_VISUALIZATION_FEED_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_MAPS_TABLE], snapshot: [VECTOR_VISUALIZATION_FEED_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE, VECTOR_VISUALIZATION_MAPS_TABLE], lastSeq: 0 }));
    const ownerBaseline = await ownerSync.wait(message => message.type === 'sync.snapshot' && message.plane === 'system');
    const outsiderBaseline = await outsiderSync.wait(message => message.type === 'sync.snapshot' && message.plane === 'system');
    if (ownerBaseline.type !== 'sync.snapshot' || outsiderBaseline.type !== 'sync.snapshot') throw new Error('Expected actual SYSTEM snapshots');
    const feed = Object.values(ownerBaseline.tables[VECTOR_VISUALIZATION_FEED_TABLE]!);
    expect(feed).toHaveLength(2); // One signal for ingestion and one for search, regardless of operation count.
    expect(feed.every(row => row.owner_user_id === owner.user.userId && typeof row.change_token === 'string')).toBe(true);
    expect(feed.map(row => row.kind).sort()).toEqual(['ingestion', 'search']);
    expect(outsiderBaseline.tables[VECTOR_VISUALIZATION_FEED_TABLE] ?? {}).toEqual({});
    expect(ownerBaseline.tables[VECTOR_VISUALIZATION_OPERATIONS_TABLE]).toBeUndefined();
    expect(outsiderBaseline.tables[VECTOR_VISUALIZATION_OPERATIONS_TABLE]).toBeUndefined();
    expect(ownerBaseline.tables[VECTOR_VISUALIZATION_MAPS_TABLE]).toBeUndefined();
    expect(JSON.stringify(ownerBaseline)).not.toContain('projection_json');
    expect(JSON.stringify(ownerBaseline)).not.toContain('snapshot_json');
    expect(JSON.stringify(ownerBaseline)).not.toContain('uniquemarker');
    // Past operation snapshots remain available only through their authorized, ID-specific HTTP read.
    expect((await request(f.base, owner.accessToken, `/api/vector-visualizations/${searches[0]!.id}?index=docs`)).body?.id).toBe(searches[0]!.id);
    const priorSearch = feed.find(row => row.kind === 'search')!;
    if (typeof priorSearch.feed_id !== 'string') throw new Error('Expected stable feed identity');
    const incoming = await request(f.base, owner.accessToken, '/api/vector-visualizations/search', {
      index: 'docs', text: 'private-live-query-not-for-sync', topK: 1, candidateCount: 2,
    });
    expect(incoming.status).toBe(202);
    const changed = await ownerSync.wait(message => message.type === 'sync.change' && message.plane === 'system'
      && message.table === VECTOR_VISUALIZATION_FEED_TABLE && message.row?.kind === 'search'
      && message.row.change_token !== priorSearch.change_token);
    if (changed.type !== 'sync.change') throw new Error('Expected actual SYSTEM feed change');
    expect(changed.rowId).toBe(priorSearch.feed_id);
    expect(changed.row).not.toHaveProperty('snapshot_json');
    expect(JSON.stringify(changed)).not.toContain('private-live-query-not-for-sync');
    expect((await complete(f.base, owner.accessToken, incoming.body!.id)).status).toBe('completed');
    expect(f.system.raw.query('SELECT count(*) AS count FROM vector_visualization_feed WHERE owner_user_id=?').get(owner.user.userId)).toEqual({ count: 2 });
  }, 90_000);
});
