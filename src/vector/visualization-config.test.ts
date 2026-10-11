/** Pure policy admission: no native collection, model, application or live database. */
import { describe, expect, it } from 'bun:test';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveVectorConfig } from './vector-config';
import { resolveVectorVisualizationConfig, type VectorVisualizationConfig } from './visualization-config';
import { VECTOR_VISUALIZATION_MAPS_TABLE, VECTOR_VISUALIZATION_OPERATIONS_TABLE } from './visualization-schema';

function vectors(readOnly = false) {
  return resolveVectorConfig({ defaultIndex: 'docs', indexes: { docs: { dimensions: 3, lexical: true, readOnly,
    metadata: { corpus_scope: 'string' } } } }, {});
}
function policy(): VectorVisualizationConfig {
  return { indexes: { docs: { scopeField: 'corpus_scope', searchPermission: 'documents:search', ingestPermission: 'documents:ingest' } } };
}
describe('vector visualization declarative admission', () => {
  it('off/omitted configuration is inert and does not provision optional tables', () => {
    const db = createReactiveDB({ mode: 'memory' });
    try {
      expect(resolveVectorVisualizationConfig(undefined, false, false, false)).toBe(false);
      expect(resolveVectorVisualizationConfig(false, false, false, false)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_OPERATIONS_TABLE)).toBe(false);
      expect(db.hasTable(VECTOR_VISUALIZATION_MAPS_TABLE)).toBe(false);
    } finally { db.dispose(); }
  });
  it('requires explicit Guardian, AI and existing native-index infrastructure', () => {
    for (const args of [[false, true, true], [vectors(), false, true], [vectors(), true, false]] as const) {
      expect(() => resolveVectorVisualizationConfig(policy(), args[0], args[1], args[2])).toThrow();
    }
    expect(() => resolveVectorVisualizationConfig({ indexes: {} }, vectors(), true, true)).toThrow();
    expect(() => resolveVectorVisualizationConfig({ indexes: { missing: policy().indexes.docs! } }, vectors(), true, true)).toThrow();
  });
  it('admits bounded immutable policies and detaches mutable arrays/config objects', () => {
    const input = policy();
    input.indexes.docs!.metadataFields = ['title', 'source_label'];
    input.indexes.docs!.chunk = { maxChars: 1000, overlapChars: 120, maxChunks: 32 };
    const result = resolveVectorVisualizationConfig(input, vectors(), true, true);
    if (!result) throw new Error('Expected policy');
    expect(result.defaultIndex).toBe('docs');
    expect(result.indexes.docs!.sampleSize).toBe(96);
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.indexes.docs!.metadataFields)).toBe(true);
    (input.indexes.docs!.metadataFields as string[]).push('secret');
    input.indexes.docs!.chunk!.maxChars = 2000;
    expect(result.indexes.docs!.metadataFields).toEqual(['title', 'source_label']);
    expect(result.indexes.docs!.chunk?.maxChars).toBe(1000);
  });
  it('rejects absent/non-string scope columns, invalid permission keys and read-only ingestion', () => {
    for (const change of [{ scopeField: 'missing' }, { scopeField: 'toString' }, { searchPermission: '' },
      { searchPermission: 'documents search' }, { searchPermission: 'documents.search' }, { ingestPermission: 'documents.ingest' },
      { ingestPermission: 'bad space' }, { scopeField: 'corpus_number' }]) {
      const input = policy(); Object.assign(input.indexes.docs!, change);
      expect(() => resolveVectorVisualizationConfig(input, vectors(), true, true)).toThrow();
    }
    const config = resolveVectorConfig({ defaultIndex: 'docs', indexes: { docs: { dimensions: 3, metadata: { corpus_scope: 'number' } } } }, {});
    expect(() => resolveVectorVisualizationConfig(policy(), config, true, true)).toThrow();
    const unindexed = resolveVectorConfig({ defaultIndex: 'docs', indexes: { docs: { dimensions: 3, metadata: { corpus_scope: { type: 'string', indexed: false } } } } }, {});
    expect(() => resolveVectorVisualizationConfig(policy(), unindexed, true, true)).toThrow();
    expect(() => resolveVectorVisualizationConfig(policy(), vectors(true), true, true)).toThrow();
    const readOnly = policy(); delete readOnly.indexes.docs!.ingestPermission;
    expect(resolveVectorVisualizationConfig(readOnly, vectors(true), true, true)).not.toBe(false);
  });
  it('rejects unbounded sample/model/chunk settings and scope field exposure', () => {
    const invalid = [ { sampleSize: 0 }, { sampleSize: 257 }, { embeddingModel: '' }, { rerankingModel: 'x'.repeat(257) },
      { metadataFields: ['corpus_scope'] }, { metadataFields: ['invalid.field'] }, { chunk: { maxChars: 63 } },
      { chunk: { maxTokens: 0 } }, { chunk: { maxChunks: 129 } }, { chunk: { maxChars: 64, overlapChars: 64 } },
      { chunk: { overlapChars: 4001 } } ];
    for (const change of invalid) {
      const input = policy(); Object.assign(input.indexes.docs!, change);
      expect(() => resolveVectorVisualizationConfig(input, vectors(), true, true)).toThrow();
    }
    expect(() => resolveVectorVisualizationConfig({ ...policy(), defaultIndex: 'missing' }, vectors(), true, true)).toThrow();
  });
});
