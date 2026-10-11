/** Managed owner qualification: one pinned writer, no live app/provider/native index. */
import { expect, test } from 'bun:test';
import { createPlatformSQLiteService } from '../persistence';
import { DatabaseRuntime } from '../databases/database-runtime';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { ManagedVectorVisualization } from './visualization-managed';
import { admitVectorVisualizationSchema } from './visualization-admission';
import { resolveVectorConfig } from './vector-config';
import type { AIService } from '../ai/ai-service';
import type { VectorService } from './vector-service';
import type { VectorVisualizationSnapshot } from './visualization-types';
import { VECTOR_VISUALIZATION_OPERATIONS_TABLE as OPS } from './visualization-schema';
import { emitPlatformCode } from '../observability/sink';
function fixture() {
  const runtime = DatabaseRuntime.open({ id: 'vector-viz-system', role: 'system', sqlite: createPlatformSQLiteService({ mode: 'ephemeral' }), ownsSQLite: true });
  let signal: AbortSignal | undefined, calls = 0;
  const ai = { async embed(input: { abortSignal?: AbortSignal }) { signal = input.abortSignal; calls++;
      return new Promise(() => {}); }, async embedMany() { return { embeddings: [] }; }, async rerank() { return { ranking: [] }; } } as unknown as AIService;
  const vectors = { scope() { return { query: async () => [], fetch: async () => [], upsert: async () => ({ ok: true, count: 0, errors: [] }) }; } } as unknown as VectorService;
  const vectorConfig = resolveVectorConfig({ defaultIndex: 'docs', indexes: { docs: { dimensions: 3, metadata: { corpus_scope: 'string' } } } }, {});
  if (!vectorConfig) throw new Error('Expected vectors');
  const options = { runtime, installAllowed: true, config: { defaultIndex: 'docs', indexes: { docs: { scopeField: 'corpus_scope', searchPermission: 'docs:read' } } }, vectorConfig, ai, vectors, emitCode: emitPlatformCode };
  return { runtime, options, get signal() { return signal; }, get calls() { return calls; } };
}
const scope = applicationServiceDataScope();
test('migrate:false does not opportunistically create missing writer infrastructure', () => {
  const f = fixture();
  try {
    admitVectorVisualizationSchema(f.runtime.db, true);
    const before = f.runtime.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all();
    expect(() => new ManagedVectorVisualization({ ...f.options, installAllowed: false })).toThrow();
    expect(f.runtime.db.prepare('SELECT name,sql FROM sqlite_master ORDER BY name').all()).toEqual(before);
  } finally { f.runtime.close(); }
});
test('current owner cancellation aborts a provider owned by another scoped service', async () => {
  const f = fixture(); const owner = new ManagedVectorVisualization(f.options);
  try {
    const service = owner.scoped('docs', scope, 'user:a', () => {}), abort = new AbortController();
    const release = owner.reserveStart(service, abort);
    const accepted = await service.startSearch({ text: 'private query', operationId: 'op:a' }, { signal: abort.signal });
    release(); owner.retain(accepted.snapshot.id, service, accepted.completion, abort);
    while (!f.signal) await Promise.resolve();
    const reader = owner.scoped('docs', scope, 'user:a', () => {});
    const cancelled = await reader.cancel('op:a');
    owner.abortAccepted('op:a');
    expect(f.signal?.aborted).toBe(true); expect(cancelled?.status).toBe('cancelled');
    expect((await accepted.completion).status).toBe('cancelled'); expect(f.calls).toBe(1);
    await reader.dispose();
  } finally { await owner.close(); f.runtime.close(); }
});
test('startup marks unfinished accepted work interrupted without running a provider', async () => {
  const f = fixture(); const owner = new ManagedVectorVisualization(f.options);
  try {
    const snapshot: VectorVisualizationSnapshot = { id: 'op:lost', index: 'docs', kind: 'ingestion', status: 'running', revision: 1,
      createdAt: '2026-10-08T12:00:00Z', updatedAt: '2026-10-08T12:00:00Z', stages: [{ id: 'index', label: 'Index', status: 'waiting' }] };
    f.runtime.db.insert(OPS, { operation_id: snapshot.id, scope_id: 'application', owner_user_id: 'user:a', tenant_id: null,
      index_name: snapshot.index, kind: snapshot.kind, status: snapshot.status, revision: 1, snapshot_json: JSON.stringify(snapshot), created_at: snapshot.createdAt, updated_at: snapshot.updatedAt });
    await owner.recoverInterrupted();
    const read = owner.scoped('docs', scope, 'user:a', () => {}); const recovered = await read.get(snapshot.id);
    expect(recovered?.status).toBe('interrupted'); expect(recovered?.revision).toBe(2);
    expect(recovered?.error?.outcomeUnknown).toBe(true); expect(f.calls).toBe(0); await read.dispose();
  } finally { await owner.close(); f.runtime.close(); }
});
test('shutdown drains reserved admissions before closing the writer engine', async () => {
  const f = fixture(); const owner = new ManagedVectorVisualization(f.options);
  try {
    const service = owner.scoped('docs', scope, 'user:a', () => {}), abort = new AbortController();
    const release = owner.reserveStart(service, abort);
    let closed = false; const close = owner.close().then(() => { closed = true; });
    expect(abort.signal.aborted).toBe(true); await Promise.resolve(); expect(closed).toBe(false);
    release(); await close; expect(closed).toBe(true); expect(f.runtime.diagnostics().closed).toBe(false);
    await expect(service.startSearch({ text: 'late' })).rejects.toThrow();
  } finally { await owner.close(); f.runtime.close(); }
});
test('a replay retained before its actual runner never displaces or cancels that effect owner', async () => {
  const f = fixture(); const owner = new ManagedVectorVisualization(f.options);
  try {
    const runner = owner.scoped('docs', scope, 'user:a', () => {}), runnerAbort = new AbortController();
    const release = owner.reserveStart(runner, runnerAbort);
    const accepted = await runner.startSearch({ text: 'private query', operationId: 'op:retain-race' }, { signal: runnerAbort.signal });
    release();
    while (!f.signal) await Promise.resolve();

    const observer = owner.scoped('docs', scope, 'user:a', () => {}), observerAbort = new AbortController();
    const replay = await observer.startSearch({ text: 'private query', operationId: 'op:retain-race' }, { signal: observerAbort.signal });
    expect(observer.ownsOperation(replay.snapshot.id)).toBe(false);
    expect(runner.ownsOperation(accepted.snapshot.id)).toBe(true);
    owner.retain(replay.snapshot.id, observer, replay.completion, observerAbort);
    owner.retain(accepted.snapshot.id, runner, accepted.completion, runnerAbort);
    await Promise.resolve();
    expect(f.signal?.aborted).toBe(false);
    expect(runner.ownsOperation(accepted.snapshot.id)).toBe(true);
    expect(f.calls).toBe(1);

    owner.abortAccepted(accepted.snapshot.id);
    expect(f.signal?.aborted).toBe(true);
    expect((await accepted.completion).status).toBe('cancelled');
    await replay.completion.catch(() => undefined);
  } finally { await owner.close(); f.runtime.close(); }
});
