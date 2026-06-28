import { describe, expect, it } from 'bun:test';

import { resolveVectorConfig } from './vector-config';
import { VectorError } from './vector-error';

describe('resolveVectorConfig', () => {
  it('disables vector storage when omitted', () => {
    expect(resolveVectorConfig(undefined, {})).toBe(false);
  });

  it('creates a default index from env-backed defaults', () => {
    const config = resolveVectorConfig(true, {
      ZERO_VECTOR_DATA_DIR: './vectors',
      ZERO_VECTOR_DEFAULT_DIMENSIONS: '768',
    });

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.defaultIndex).toBe('default');
    expect(config.indexes.default.dimensions).toBe(768);
    expect(config.indexes.default.path).toContain('vectors');
    expect(config.indexes.default.metadata.bucket.type).toBe('string');
  });

  it('normalizes explicit indexes and metadata fields', () => {
    const config = resolveVectorConfig({
      dataDir: './data/vector',
      defaultIndex: 'docs',
      indexes: {
        docs: {
          dimensions: 1024,
          metadata: {
            department: { type: 'string', indexed: true },
            priority: { type: 'number', range: false },
          },
        },
      },
    }, {});

    expect(config).not.toBe(false);
    if (config === false) return;
    expect(config.indexes.docs.dimensions).toBe(1024);
    expect(config.indexes.docs.metadata.department.indexed).toBe(true);
    expect(config.indexes.docs.metadata.priority.type).toBe('number');
    expect(config.indexes.docs.metadata.priority.range).toBe(false);
  });

  it('rejects invalid dimensions', () => {
    expect(() => resolveVectorConfig({ indexes: { docs: 0 } }, {})).toThrow(VectorError);
  });

  it('rejects metadata field collisions with reserved fields', () => {
    expect(() => resolveVectorConfig({
      indexes: {
        docs: {
          dimensions: 3,
          metadata: {
            text: 'string',
          },
        },
      },
    }, {})).toThrow(VectorError);
  });

  it('rejects metadata field collisions with internal zvec fields', () => {
    expect(() => resolveVectorConfig({
      indexes: {
        docs: {
          dimensions: 3,
          metadata: {
            _zero_id: 'string',
          },
        },
      },
    }, {})).toThrow(VectorError);
  });
});
