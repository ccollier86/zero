import { describe, expect, test } from 'bun:test';

import {
  AI_DEFAULT_EMBED_PARALLEL_CALLS,
  AI_MAX_AGGREGATE_BYTES,
  AI_MAX_ITEM_BYTES,
  AI_MAX_OPERATION_ITEMS,
  AI_MAX_RERANK_QUERY_BYTES,
  validateAIEmbedManyInput,
  validateAIRerankInput,
} from './ai-operation-limits';

describe('AI operation limits', () => {
  test('bounds and snapshots multi-value embedding input', () => {
    const source = ['one', 'two'];
    const validated = validateAIEmbedManyInput({ values: source });
    source[0] = 'changed';

    expect(validated).toEqual({
      values: ['one', 'two'],
      maxParallelCalls: AI_DEFAULT_EMBED_PARALLEL_CALLS,
    });
    expect(capture(() => validateAIEmbedManyInput({ values: [] }))).toMatchObject({
      code: 'AI_REQUEST_INVALID',
      status: 400,
    });
    expect(capture(() => validateAIEmbedManyInput({
      values: new Array(AI_MAX_OPERATION_ITEMS + 1).fill('x'),
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(capture(() => validateAIEmbedManyInput({
      values: ['x'.repeat(AI_MAX_ITEM_BYTES + 1)],
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(capture(() => validateAIEmbedManyInput({
      values: new Array((AI_MAX_AGGREGATE_BYTES / AI_MAX_ITEM_BYTES) + 1)
        .fill('x'.repeat(AI_MAX_ITEM_BYTES)),
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
  });

  test('measures UTF-8 bytes and validates concurrency and retry ranges', () => {
    expect(capture(() => validateAIEmbedManyInput({
      values: ['é'.repeat((AI_MAX_ITEM_BYTES / 2) + 1)],
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });

    for (const maxParallelCalls of [0, 1.5, 33]) {
      expect(capture(() => validateAIEmbedManyInput({ values: ['x'], maxParallelCalls })))
        .toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    }
    for (const maxRetries of [-1, 1.5, 11]) {
      expect(capture(() => validateAIEmbedManyInput({ values: ['x'], maxRetries })))
        .toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    }
    expect(validateAIEmbedManyInput({
      values: ['x'],
      maxParallelCalls: 32,
      maxRetries: 0,
    })).toMatchObject({ maxParallelCalls: 32, maxRetries: 0 });
  });

  test('bounds rerank query, document count, item bytes, and aggregate bytes', () => {
    expect(capture(() => validateAIRerankInput({ query: '   ', documents: ['x'] })))
      .toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(capture(() => validateAIRerankInput({
      query: 'é'.repeat((AI_MAX_RERANK_QUERY_BYTES / 2) + 1),
      documents: ['x'],
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(capture(() => validateAIRerankInput({ query: 'q', documents: [] })))
      .toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    expect(capture(() => validateAIRerankInput({
      query: 'q',
      documents: new Array(AI_MAX_OPERATION_ITEMS + 1).fill('x'),
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(capture(() => validateAIRerankInput({
      query: 'q',
      documents: ['x'.repeat(AI_MAX_ITEM_BYTES + 1)],
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
    expect(capture(() => validateAIRerankInput({
      query: 'q',
      documents: new Array((AI_MAX_AGGREGATE_BYTES / AI_MAX_ITEM_BYTES) + 1)
        .fill('x'.repeat(AI_MAX_ITEM_BYTES)),
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
  });

  test('requires homogeneous, plain, finite, acyclic JSON object documents', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const accessor: Record<string, unknown> = {};
    Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 'secret' });
    const sparse = new Array(2);
    sparse[1] = 'present';

    for (const documents of [
      ['text', { text: 'object' }],
      [circular],
      [{ score: Number.NaN }],
      [accessor],
      [{ sparse }],
      [{ date: new Date() }],
      [{ unsupported: undefined }],
    ]) {
      expect(capture(() => validateAIRerankInput({ query: 'q', documents })))
        .toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    }
  });

  test('deeply snapshots valid shared JSON and validates topN and retries', () => {
    const shared = { label: 'original', scores: [1, 2] };
    const source = [{ left: shared, right: shared }];
    const validated = validateAIRerankInput({
      query: 'match',
      documents: source,
      topN: 1,
      maxRetries: 10,
    });
    shared.label = 'changed';
    shared.scores[0] = 9;

    expect(validated.documents).toEqual([{
      left: { label: 'original', scores: [1, 2] },
      right: { label: 'original', scores: [1, 2] },
    }]);
    expect(validated).toMatchObject({ topN: 1, maxRetries: 10 });
    for (const topN of [0, 2, 1.5]) {
      expect(capture(() => validateAIRerankInput({
        query: 'q', documents: ['one'], topN,
      }))).toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    }
    for (const maxRetries of [-1, 11, 1.5]) {
      expect(capture(() => validateAIRerankInput({
        query: 'q', documents: ['one'], maxRetries,
      }))).toMatchObject({ code: 'AI_REQUEST_INVALID', status: 400 });
    }
  });

  test('uses serialized JSON bytes for object document limits', () => {
    expect(capture(() => validateAIRerankInput({
      query: 'q',
      documents: [{ value: 'x'.repeat(AI_MAX_ITEM_BYTES) }],
    }))).toMatchObject({ code: 'AI_REQUEST_LIMIT_EXCEEDED', status: 413 });
  });
});

function capture(action: () => unknown): unknown {
  let caught: unknown;
  try {
    action();
  } catch (error) {
    caught = error;
  }
  expect(caught).toBeDefined();
  return caught;
}
