import { describe, expect, test } from 'bun:test';

import type { DatabaseCommitResult } from '../databases/database-operations';
import { canonicalizeResourceReceiptPayload } from './resource-crud-service';
import { defineResource } from './resource-definition';
import { resourceMutationEffect } from './resource-mutation-receipt';
import { authenticatedOnly } from './resource-policy-helpers';
import { createResourceRegistry } from './resource-registry';

describe('Resource logical receipt canonicalization', () => {
  test('ignores object insertion order recursively while preserving array order', () => {
    const left = {
      outer: {
        z: 3,
        nested: [{ b: 2, a: 1 }, { value: true }],
      },
      first: 'same',
    };
    const right = {
      first: 'same',
      outer: {
        nested: [{ a: 1, b: 2 }, { value: true }],
        z: 3,
      },
    };

    expect(canonicalizeResourceReceiptPayload(left))
      .toBe(canonicalizeResourceReceiptPayload(right));
    expect(canonicalizeResourceReceiptPayload({ values: [1, 2] }))
      .not.toBe(canonicalizeResourceReceiptPayload({ values: [2, 1] }));
  });

  test('rejects cyclic, sparse, non-finite, and non-plain payloads', () => {
    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    const sparse = new Array(2);
    sparse[1] = 'value';

    expect(() => canonicalizeResourceReceiptPayload(cyclic)).toThrow('cycle');
    expect(() => canonicalizeResourceReceiptPayload(sparse)).toThrow('sparse');
    expect(() => canonicalizeResourceReceiptPayload({ value: Number.NaN }))
      .toThrow('non-finite');
    expect(() => canonicalizeResourceReceiptPayload(new Date()))
      .toThrow('non-plain');
  });

  test('strictly binds actor effects to action, sequence, and canonical row identity', () => {
    const resource = createResourceRegistry({
      resources: [defineResource({
        table: 'todos',
        exposure: 'http',
        policy: authenticatedOnly(),
      })],
      tables: {
        todos: {
          id: 'text primary key',
          title: 'text not null',
        },
      },
      authConfig: { userProperties: {} },
    }).getByTable('todos')!;
    const valid = {
      value: {
        kind: 'mutation',
        mutation: {
          type: 'create',
          table: 'todos',
          rowId: 'a',
          changed: true,
          op: 'INSERT',
          sequence: { seq: 3 },
          row: { id: 'a', title: 'A' },
          previousRow: null,
        },
      },
      sequence: { seq: 3 },
      idempotencyKey: 'resource:test',
      replayed: false,
    } as DatabaseCommitResult;

    expect(resourceMutationEffect(valid, resource, 'create')).toEqual({
      type: 'create',
      table: 'todos',
      rowId: 'a',
      row: { id: 'a', title: 'A' },
      previousRow: null,
    });

    for (const mutate of [
      (candidate: any) => { candidate.value.mutation.op = 'DELETE'; },
      (candidate: any) => { candidate.value.mutation.sequence.seq = 2; },
      (candidate: any) => { candidate.value.mutation.previousRow = { id: 'a' }; },
      (candidate: any) => { candidate.value.mutation.row.id = 'forged'; },
    ]) {
      const candidate = structuredClone(valid) as DatabaseCommitResult;
      mutate(candidate);
      expect(resourceMutationEffect(candidate, resource, 'create')).toBeNull();
    }
  });
});
