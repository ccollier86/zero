import { describe, expect, test } from 'bun:test';

import { normalizeAIProviderOptions } from './ai-provider-options';
import type { AIProviderOptions } from './ai-types';

describe('AI provider request options', () => {
  test('keeps the broad source-compatible type while returning an immutable JSON snapshot', () => {
    const source: AIProviderOptions = {
      provider: {
        mode: 'strict',
        nested: { enabled: true },
        values: [1, 2],
      },
    };

    const snapshot = normalizeAIProviderOptions(source)!;
    (source.provider.nested as { enabled: boolean }).enabled = false;
    (source.provider.values as number[]).push(3);

    expect(snapshot).toEqual({
      provider: {
        mode: 'strict',
        nested: { enabled: true },
        values: [1, 2],
      },
    });
    expect(Object.isFrozen(snapshot)).toBe(true);
    expect(Object.isFrozen(snapshot.provider)).toBe(true);
    expect(Object.isFrozen(snapshot.provider.nested)).toBe(true);
    expect(Object.isFrozen(snapshot.provider.values)).toBe(true);
  });

  test('rejects functions, collection objects, accessors, cycles, and non-finite numbers', () => {
    const accessor = {} as Record<string, unknown>;
    Object.defineProperty(accessor, 'secret', { enumerable: true, get: () => 'private' });
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;

    for (const value of [
      { provider: { hook: () => undefined } },
      { provider: { lookup: new Map([['key', 'value']]) } },
      { provider: accessor },
      { provider: cyclic },
      { provider: { score: Number.NaN } },
    ] as AIProviderOptions[]) {
      expect(() => normalizeAIProviderOptions(value)).toThrow(expect.objectContaining({
        code: 'AI_REQUEST_INVALID',
        status: 400,
      }));
    }
  });

  test('bounds serialized provider options before they reach an SDK', () => {
    expect(() => normalizeAIProviderOptions({
      provider: { payload: 'x'.repeat(1024 * 1024) },
    })).toThrow(expect.objectContaining({
      code: 'AI_REQUEST_LIMIT_EXCEEDED',
      status: 413,
    }));
  });
});
