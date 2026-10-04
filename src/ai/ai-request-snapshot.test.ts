import { describe, expect, test } from 'bun:test';

import {
  snapshotAIHeaders,
  snapshotAIStringList,
  snapshotAITimeout,
  snapshotAIToolApprovalSecret,
} from './ai-request-snapshot';

describe('AI request control snapshots', () => {
  test('detaches and freezes headers, string lists, timeout maps, and signing keys', () => {
    const headers = { authorization: 'Bearer original', omitted: undefined };
    const stop = ['END'];
    const timeout = { totalMs: 5_000, tools: { lookupMs: 250 } };
    const secret = new Uint8Array([1, 2, 3]);

    const headerSnapshot = snapshotAIHeaders(headers)!;
    const stopSnapshot = snapshotAIStringList(stop, 'stopSequences')!;
    const timeoutSnapshot = snapshotAITimeout(timeout)! as typeof timeout;
    const secretSnapshot = snapshotAIToolApprovalSecret(secret) as Uint8Array;

    headers.authorization = 'Bearer mutated';
    stop[0] = 'MUTATED';
    timeout.tools.lookupMs = 999;
    secret[0] = 9;

    expect(headerSnapshot).toEqual({ authorization: 'Bearer original' });
    expect(stopSnapshot).toEqual(['END']);
    expect(timeoutSnapshot).toEqual({ totalMs: 5_000, tools: { lookupMs: 250 } });
    expect(secretSnapshot).toEqual(new Uint8Array([1, 2, 3]));
    expect(Object.isFrozen(headerSnapshot)).toBe(true);
    expect(Object.isFrozen(stopSnapshot)).toBe(true);
    expect(Object.isFrozen(timeoutSnapshot)).toBe(true);
    expect(Object.isFrozen(timeoutSnapshot.tools)).toBe(true);
  });

  test('rejects accessor headers, header injection, and invalid timer delays', () => {
    const accessor = Object.defineProperty({}, 'authorization', {
      enumerable: true,
      get() {
        throw new Error('must not execute');
      },
    });
    expect(() => snapshotAIHeaders(accessor as Record<string, string>))
      .toThrow(expect.objectContaining({ code: 'AI_REQUEST_INVALID' }));
    expect(() => snapshotAIHeaders({ 'x-test': 'safe\r\ninjected: yes' }))
      .toThrow(expect.objectContaining({ code: 'AI_REQUEST_INVALID' }));

    for (const timeout of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => snapshotAITimeout(timeout))
        .toThrow(expect.objectContaining({ code: 'AI_REQUEST_INVALID' }));
    }
  });
});
