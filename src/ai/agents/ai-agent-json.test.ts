import { describe, expect, test } from 'bun:test';

import { snapshotAIAgentJSON } from './ai-agent-json';

describe('AI agent JSON snapshots', () => {
  test('returns a detached, deeply frozen snapshot with exact UTF-8 bytes', () => {
    const source = { nested: { label: 'é' }, values: [1, 2] };
    const snapshot = snapshotAIAgentJSON(
      source,
      'AI agent context',
      'AI_AGENT_CONTEXT_INVALID',
    );
    source.nested.label = 'changed';
    source.values.push(3);

    expect(snapshot.value).toEqual({ nested: { label: 'é' }, values: [1, 2] });
    expect(snapshot.bytes).toBe(new TextEncoder().encode(JSON.stringify(snapshot.value)).byteLength);
    expect(Object.isFrozen(snapshot.value)).toBe(true);
    expect(Object.isFrozen(snapshot.value.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.value.values)).toBe(true);
  });

  test('rejects object types and shapes that JSON would erase or transform', () => {
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 'private' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = 'present';

    for (const value of [
      new Map([['key', 'value']]),
      new Set(['value']),
      new Uint8Array([1]),
      new ArrayBuffer(1),
      accessor,
      cyclic,
      sparse,
      { value: Number.NaN },
      { value: () => undefined },
    ]) {
      expect(() => snapshotAIAgentJSON(
        value,
        'AI agent context',
        'AI_AGENT_CONTEXT_INVALID',
      )).toThrow(expect.objectContaining({
        code: 'AI_AGENT_CONTEXT_INVALID',
        status: 400,
      }));
    }
  });
});
