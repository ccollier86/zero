import { describe, expect, it } from 'bun:test';

import type { AIService } from '../ai';
import { createAIVectorBridge } from './vector-ai-bridge';
import type { StoredVectorRecord, VectorFilter, VectorQueryOptions, VectorRecord } from './vector-types';

describe('createAIVectorBridge', () => {
  it('embeds text before upserting vector records', async () => {
    const ai = fakeAI();
    const vectors = fakeVectors();
    const bridge = createAIVectorBridge({ ai, vectors, embeddingModel: 'embedding' });

    await bridge.embedAndUpsert('docs', {
      id: 'doc_1',
      text: 'hello',
      metadata: { bucket: 'docs' },
    });

    expect(vectors.lastUpsert?.index).toBe('docs');
    expect(vectors.lastUpsert?.records[0]).toEqual({
      id: 'doc_1',
      text: 'hello',
      metadata: { bucket: 'docs' },
      vector: [5, 6, 7],
    });
  });

  it('embeds query text before searching', async () => {
    const vectors = fakeVectors();
    const bridge = createAIVectorBridge({ ai: fakeAI(), vectors });

    await bridge.embedAndQuery('docs', {
      text: 'find me',
      filter: { bucket: 'docs' },
      topK: 3,
    });

    expect(vectors.lastQuery).toEqual({
      index: 'docs',
      options: {
        text: 'find me',
        filter: { bucket: 'docs' },
        topK: 3,
        vector: [7, 8, 9],
      },
    });
  });
});

function fakeAI(): AIService {
  return {
    embed: async ({ value }: { value: string }) => ({
      embedding: [value.length, value.length + 1, value.length + 2],
      value,
    }),
  } as unknown as AIService;
}

function fakeVectors() {
  return {
    lastUpsert: null as null | { index: string; records: VectorRecord[] },
    lastQuery: null as null | { index: string; options: VectorQueryOptions },
    async upsert(index: string, records: VectorRecord | readonly VectorRecord[]) {
      this.lastUpsert = {
        index,
        records: Array.isArray(records) ? [...records] : [records],
      };
      return { ok: true, count: this.lastUpsert.records.length, errors: [] };
    },
    async query(index: string, options: VectorQueryOptions): Promise<StoredVectorRecord[]> {
      this.lastQuery = { index, options };
      return [];
    },
    scope(_index: string, filter: VectorFilter) {
      return {
        upsert: (records: VectorRecord | readonly VectorRecord[]) => this.upsert('scoped', records),
        query: (options: VectorQueryOptions) => this.query('scoped', {
          ...options,
          filter,
        }),
      };
    },
  } as any;
}
