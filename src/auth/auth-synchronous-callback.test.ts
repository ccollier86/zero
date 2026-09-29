import { describe, expect, test } from 'bun:test';
import { OBS_CODES } from '../observability/codes';
import { emitPlatformCode } from '../observability/sink';
import { invokeSynchronousAuthCallback } from './auth-synchronous-callback';
import { AuthError } from './types';

describe('synchronous auth callback boundary', () => {
  test('preserves ordinary return values', () => {
    expect(invokeSynchronousAuthCallback(() => 42, {
      component: 'test',
      invariant: 'sync-return',
      message: 'must be synchronous',
    })).toBe(42);
  });

  test('preserves a synchronously thrown domain error without duplicate emission', () => {
    const original = new AuthError('Access changed', 'AUTH_STATE_CHANGED', 409);
    let emissions = 0;

    expect(() => invokeSynchronousAuthCallback(() => {
      throw original;
    }, {
      component: 'test',
      invariant: 'sync-domain-error',
      message: 'must be synchronous',
      emitCode: (definition, options) => {
        emissions += 1;
        return emitPlatformCode(definition, options);
      },
    })).toThrow(original);
    expect(emissions).toBe(0);
  });

  test('rejects thenables, consumes rejection, and emits only stable metadata', async () => {
    const emitted: Array<{ code: string; metadata: unknown }> = [];
    const callback = () => Promise.reject(new Error('private callback failure'));

    expect(() => invokeSynchronousAuthCallback(callback, {
      component: 'test-boundary',
      invariant: 'thenable-return',
      message: '[auth] Test callback must be synchronous.',
      emitCode: (definition, options) => {
        emitted.push({ code: definition.code, metadata: options?.metadata });
        return emitPlatformCode(definition, options);
      },
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Test callback must be synchronous.',
    }));
    await Promise.resolve();

    expect(emitted).toEqual([{
      code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      metadata: { component: 'test-boundary', invariant: 'thenable-return' },
    }]);
    expect(JSON.stringify(emitted)).not.toContain('private callback failure');
  });

  test('normalizes a throwing then getter without leaking its error', () => {
    const emitted: Array<{ code: string; metadata: unknown }> = [];
    const hostileResult = Object.defineProperty({}, 'then', {
      get() {
        throw new Error('private then getter failure');
      },
    });

    expect(() => invokeSynchronousAuthCallback(() => hostileResult, {
      component: 'hostile-boundary',
      invariant: 'then-getter',
      message: '[auth] Hostile callback must be synchronous.',
      emitCode: (definition, options) => {
        emitted.push({ code: definition.code, metadata: options?.metadata });
        return emitPlatformCode(definition, options);
      },
    })).toThrow(expect.objectContaining({
      code: 'AUTH_STATE_INVARIANT_FAILED',
      status: 500,
      message: '[auth] Hostile callback must be synchronous.',
    }));

    expect(emitted).toEqual([{
      code: OBS_CODES.AUTH_STATE_INVARIANT_FAILED.code,
      metadata: { component: 'hostile-boundary', invariant: 'then-getter' },
    }]);
    expect(JSON.stringify(emitted)).not.toContain('private then getter failure');
  });
});
