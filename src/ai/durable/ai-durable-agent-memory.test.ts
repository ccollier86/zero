import { describe, expect, test } from 'bun:test';

import type { WorkflowMemoryContext } from '../../workflows/workflow-memory-context';
import type { WorkflowJsonValue } from '../../workflows/workflow-json-value';
import {
  createAIDurableMemorySeed,
  readAIDurableMemory,
  writeAIDurableMemory,
} from './ai-durable-agent-memory';

describe('durable AI agent private memory codec', () => {
  test('round-trips UTF-8 chunks and removes stale chunks on replacement', () => {
    const memory = createMemory();
    const value = {
      marker: 'private',
      text: `prefix-${'🧠'.repeat(20_000)}-suffix`,
    };
    for (const [key, entry] of Object.entries(createAIDurableMemorySeed('large', value))) {
      memory.set(key, entry);
    }

    expect(memory.entries().filter(([key]) => key.startsWith('large.chunk.')).length)
      .toBeGreaterThan(1);
    expect(readAIDurableMemory<typeof value>(memory, 'large')).toEqual(value);

    writeAIDurableMemory(memory, 'large', { marker: 'replacement' });
    expect(readAIDurableMemory<{ marker: string }>(memory, 'large'))
      .toEqual({ marker: 'replacement' });
    expect(memory.entries().filter(([key]) => key.startsWith('large.chunk.'))).toHaveLength(1);
  });

  test('rejects corrupt manifests before an unbounded chunk scan', () => {
    const memory = createMemory();
    memory.set('corrupt.manifest', {
      version: 1,
      chunks: 10_000,
      bytes: 1,
    });

    expect(() => readAIDurableMemory(memory, 'corrupt')).toThrow(
      'Durable AI agent private state is invalid',
    );
  });
});

function createMemory(): WorkflowMemoryContext {
  const values = new Map<string, WorkflowJsonValue>();
  return {
    get: (key) => values.get(key),
    has: (key) => values.has(key),
    set: (key, value) => {
      values.set(key, value as WorkflowJsonValue);
    },
    update: (key, updater) => {
      const current = values.get(key);
      if (current === undefined) throw new Error(`Missing test memory key: ${key}`);
      values.set(key, updater(current) as WorkflowJsonValue);
    },
    delete: (key) => values.delete(key),
    entries: () => [...values.entries()],
    toJSON: () => Object.fromEntries(values),
  };
}
