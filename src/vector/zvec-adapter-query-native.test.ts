/** Real installed binding regression. Synthetic vectors only; no providers or application collections. */
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'bun:test';
import { resolveVectorConfig, ZvecAdapter, type ResolvedVectorIndexConfig, type VectorQueryTuningConfig, type VectorRecord } from './index';

describe('native HNSW optional query parameters', () => {
  let root: string | undefined, marker: string | undefined;
  let identity: Awaited<ReturnType<typeof lstat>> | undefined;
  let index: ResolvedVectorIndexConfig, adapter: ZvecAdapter | undefined;
  const vector = (record: number) => Array.from({ length: 1024 }, (_, dimension) => Math.sin((record + 1) * (dimension + 1) * 0.013) + 0.2);
  const queryVector = vector(1);
  const filter = { tenantId: 'synthetic-allowed', kind: 'profile', active: true };

  beforeAll(async () => {
    // Honor the qualification host's external TMPDIR; never invent an internal
    // fallback or use a live installation's index directory.
    const parent = tmpdir(); await mkdir(parent, { recursive: true });
    root = await mkdtemp(join(parent, 'zero-vector-query-native-'));
    identity = await lstat(root);
    marker = JSON.stringify({ schema: 1, kind: 'synthetic-test-fixture', project: 'zero-platform',
      allocator: 'src/vector/zvec-adapter-query-native.test.ts', run_id: randomUUID() }) + '\n';
    await writeFile(join(root, '.storage-synthetic-fixture.json'), marker, { flag: 'wx', mode: 0o600 });
    const config = resolveVectorConfig({ indexes: { default: { dimensions: 1024,
      indexType: 'hnsw', lexical: true, path: join(root, 'corpus'),
      metadata: { kind: 'string', active: 'boolean' },
    } } }, {});
    if (!config) throw new Error('Expected synthetic native vector configuration.');
    index = config.indexes.default!;
    adapter = new ZvecAdapter({ config: index, emitCode: () => undefined as never });
    const records: VectorRecord[] = Array.from({ length: 128 }, (_, number) => ({
      id: `synthetic-${number}`, vector: number === 0 ? queryVector : vector(number),
      text: number < 2 ? 'syntheticquerymarker' : `Synthetic vector entry ${number}`,
      metadata: { tenantId: number % 4 === 0 ? 'synthetic-other' : 'synthetic-allowed',
        kind: number % 3 === 0 ? 'other' : 'profile', active: number % 2 === 1 },
    }));
    expect(await adapter.upsert(records)).toMatchObject({ ok: true, count: 128, errors: [] });
    await adapter.optimize();
  }, 45_000);

  afterAll(async () => {
    // Never remove native files while their collection may still be open.
    try { await adapter?.dispose(); }
    catch (error) { console.error(`Native vector fixture retained after close failure: ${root}`); throw error; }
    if (!root) return;
    const current = await lstat(root);
    if (!identity || current.isSymbolicLink() || current.dev !== identity.dev || current.ino !== identity.ino
      || await realpath(root) !== root || !marker || await readFile(join(root, '.storage-synthetic-fixture.json'), 'utf8') !== marker) {
      throw new Error(`Native vector fixture ownership changed; preserving ${root}`);
    }
    await rm(root, { recursive: true });
  }, 20_000);

  async function search(query?: VectorQueryTuningConfig) {
    if (!adapter) throw new Error('Native vector fixture is not ready.');
    const rows = await adapter.query({ vector: queryVector, topK: 8, filter, ...(query ? { query } : {}) });
    expect(rows).toHaveLength(8);
    expect(rows.every(row => row.metadata.tenantId === filter.tenantId && row.metadata.kind === filter.kind && row.metadata.active === true)).toBe(true);
    expect(rows.some(row => row.id === 'synthetic-0')).toBe(false);
    return rows;
  }

  it('queries the native HNSW index with no query tuning object', async () => { await search(); }, 20_000);
  it('passes supplied ef without inventing radius or linear keys', async () => { await search({ ef: 128 }); }, 20_000);
  it('omits explicitly undefined optional fields at the native boundary', async () => {
    await search({ ef: undefined, linear: undefined, radius: undefined });
  }, 20_000);
  it('preserves explicit false/zero and the existing all-supplied workaround', async () => {
    await search({ linear: false }); await search({ radius: 0 });
    await search({ ef: 128, linear: false, radius: 0 }); await search({ linear: true, radius: 0 });
  }, 20_000);
  it('preserves configured tuning and accepts per-call false/zero overrides', async () => {
    index.query = { ef: 64, linear: true, radius: 0.5 };
    try {
      const rows = await adapter!.query({ vector: queryVector, topK: 8, filter });
      expect(rows.some(row => row.id === 'synthetic-1')).toBe(true);
      await search({ linear: false, radius: 0 });
    } finally { index.query = {}; }
  }, 20_000);
  it('uses the same omitted-parameter mapping for the native hybrid dense leg', async () => {
    const rows = await adapter!.query({ vector: queryVector, text: 'syntheticquerymarker', retrieval: 'hybrid', topK: 8, filter });
    expect(rows.some(row => row.id === 'synthetic-1')).toBe(true);
    expect(rows.every(row => row.metadata.tenantId === filter.tenantId && row.metadata.kind === filter.kind && row.metadata.active === true)).toBe(true);
  }, 20_000);
  it('keeps actual native parameter rejection inside the sanitized error boundary', async () => {
    let rejected: unknown;
    try { await adapter!.query({ vector: queryVector, query: { radius: 'synthetic-private-native-radius' } as unknown as VectorQueryTuningConfig }); }
    catch (error) { rejected = error; }
    expect(rejected).toMatchObject({ code: 'VECTOR_OPERATION_FAILED', message: 'Vector retrieval failed.' });
    expect(JSON.stringify(rejected)).not.toContain('synthetic-private-native-radius');
    expect(JSON.stringify(rejected)).not.toContain('Expected a number');
  }, 20_000);
  it('reopens the same native collection and queries without a rebuild or tuning workaround', async () => {
    await adapter!.dispose();
    adapter = new ZvecAdapter({ config: index, emitCode: () => undefined as never });
    await search();
    expect((await adapter.stats()).documentCount).toBe(128);
  }, 20_000);
});
