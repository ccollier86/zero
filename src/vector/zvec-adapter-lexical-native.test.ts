/** Disposable installed-engine proof: no provider calls or application collections. */
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { expect, it } from 'bun:test';
import { resolveVectorConfig } from './vector-config';
import { VectorRegistry } from './vector-registry';
import { VectorService } from './vector-service';
import { createAIVectorBridge } from './vector-ai-bridge';
import type { AIService } from '../ai/ai-service';

it('native FTS retrieves an independently matching corpus row and scopes both hybrid legs', async () => {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'vector-native-lexical-'));
  const config = resolveVectorConfig({ indexes: { default: { dimensions: 2, lexical: true, indexType: 'flat', path: join(root, 'corpus') } } }, {});
  if (!config) throw new Error('Expected fixture config');
  const service = new VectorService(new VectorRegistry({ config }), { emitCode: () => undefined as never });
  try {
    await service.upsert([
      { id: 'dense-first', vector: [1, 0], text: 'semantically related ordinary text', metadata: { tenantId: 'mine' } },
      { id: 'lexical-only', vector: [-1, 0], text: 'uniquemarker literal matching document', metadata: { tenantId: 'mine' } },
      { id: 'forbidden', vector: [1, 0], text: 'uniquemarker literal matching document', metadata: { tenantId: 'other' } },
    ]);
    const scope = service.scope({ tenantId: 'mine' });
    expect((await scope.query({ vector: [1, 0], topK: 1 })).map(row => row.id)).toEqual(['dense-first']);
    const lexical = await scope.query({ text: 'uniquemarker', topK: 3, includeVector: true });
    expect(lexical.map(row => row.id)).toEqual(['lexical-only']);
    expect(lexical[0]?.score).toEqual(expect.any(Number));
    expect(lexical[0]?.vector).toEqual([-1, 0]);
    const hybrid = await scope.query({ vector: [1, 0], text: 'uniquemarker', retrieval: 'hybrid', topK: 2, candidateCount: 3, includeVector: true });
    expect(new Set(hybrid.map(row => row.id))).toEqual(new Set(['dense-first', 'lexical-only']));
    expect(hybrid.some(row => row.id === 'forbidden')).toBe(false);
    expect(hybrid.every(row => row.vector?.length === 2)).toBe(true);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);

it('native custom body fields retain hydrated vector and hybrid hits with scalar text metadata', async () => {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'vector-native-body-'));
  const config = resolveVectorConfig({ indexes: { default: { dimensions: 2, lexical: true,
    textField: 'body', metadata: { text: { type: 'string', indexed: true } }, indexType: 'flat', path: join(root, 'corpus') } } }, {});
  if (!config) throw new Error('Expected fixture config');
  const service = new VectorService(new VectorRegistry({ config }), { emitCode: () => undefined as never });
  try {
    await service.upsert([
      { id: 'allowed', vector: [1, 0], text: 'uniquebodymarker matching content', metadata: { tenantId: 'mine', text: 'matching label' } },
      { id: 'forbidden', vector: [1, 0], text: 'uniquebodymarker matching content', metadata: { tenantId: 'other', text: 'matching label' } },
      { id: 'other-label', vector: [1, 0], text: 'uniquebodymarker matching content', metadata: { tenantId: 'mine', text: 'other label' } },
    ]);
    const scope = service.scope({ tenantId: 'mine' });
    for (const retrieval of ['lexical', 'hybrid'] as const) {
      const rows = await scope.query({ text: 'uniquebodymarker', retrieval, includeVector: true,
        ...(retrieval === 'hybrid' ? { vector: [1, 0] } : {}), filter: { text: 'matching label' } });
      expect(rows.map(row => row.id)).toEqual(['allowed']);
      expect(rows[0]?.text).toBe('uniquebodymarker matching content');
      expect(rows[0]?.vector).toEqual([1, 0]);
    }
    await expect(scope.query({ text: 'uniquebodymarker', filter: { body: 'uniquebodymarker matching content' } }))
      .rejects.toMatchObject({ code: 'VECTOR_FILTER_INVALID' });
  } finally { await service.dispose(); await rm(root, { recursive: true, force: true }); }
}, 20_000);

it('explicit native FTS migration indexes existing text and updates without a parallel corpus', async () => {
  const scratch = process.platform === 'darwin' ? '/Volumes/code-bank/tmp/scratch/zero-platform' : tmpdir();
  await mkdir(scratch, { recursive: true });
  const root = await mkdtemp(join(scratch, 'vector-native-lexical-migrate-'));
  const resolve = (lexical: boolean) => {
    const config = resolveVectorConfig({ indexes: { default: { dimensions: 2, lexical, indexType: 'flat', path: join(root, 'corpus') } } }, {});
    if (!config) throw new Error('Expected fixture config');
    return new VectorService(new VectorRegistry({ config }), { emitCode: () => undefined as never });
  };
  let service = resolve(false);
  try {
    await service.upsert({ id: 'existing', vector: [1, 0], text: 'uniquemigrationmarker original content' });
    const bridge = createAIVectorBridge({ vectors: service, ai: { embed: async () => ({ embedding: [1, 0] }) } as unknown as AIService });
    expect((await bridge.embedAndQuery('default', { text: 'legacy dense query' })).map(row => row.id)).toEqual(['existing']);
    expect((await bridge.scope('default', { id: 'existing' }).embedAndQuery({ text: 'legacy scoped dense query' })).map(row => row.id)).toEqual(['existing']);
    await service.dispose();
    service = resolve(true);
    expect((await service.query({ text: 'uniquemigrationmarker' })).map(row => row.id)).toEqual(['existing']);
    await service.upsert({ id: 'existing', vector: [1, 0], text: 'changed replacement content' });
    expect(await service.query({ text: 'uniquemigrationmarker' })).toEqual([]);
    expect((await service.query({ text: 'replacement' })).map(row => row.id)).toEqual(['existing']);
  } finally {
    await service.dispose();
    await rm(root, { recursive: true, force: true });
  }
}, 20_000);
