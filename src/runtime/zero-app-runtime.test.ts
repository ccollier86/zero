import { describe, expect, test } from 'bun:test';

import {
  createZeroRuntimeServiceKey,
  ZeroAppRuntime,
} from './zero-app-runtime';

describe('ZeroAppRuntime', () => {
  test('keeps identically keyed service kinds isolated by app runtime', () => {
    const service = createZeroRuntimeServiceKey<{ app: string }>('example');
    const first = new ZeroAppRuntime('first');
    const second = new ZeroAppRuntime('second');

    first.set(service, { app: 'first' });
    second.set(service, { app: 'second' });

    expect(first.require(service)).toEqual({ app: 'first' });
    expect(second.require(service)).toEqual({ app: 'second' });
  });

  test('clears only the expected service instance', () => {
    const key = createZeroRuntimeServiceKey<object>('example');
    const runtime = new ZeroAppRuntime('clear-test');
    const stale = {};
    const current = {};

    runtime.set(key, stale);
    runtime.set(key, current);
    runtime.clear(key, stale);
    expect(runtime.get(key)).toBe(current);
    runtime.clear(key, current);
    expect(runtime.get(key)).toBeNull();
  });

  test('disposes once in reverse dependency order', async () => {
    const runtime = new ZeroAppRuntime('dispose-test');
    const calls: string[] = [];
    runtime.addCleanup(() => {
      calls.push('provider');
    });
    runtime.addCleanup(async () => {
      calls.push('dependent');
    });

    const first = runtime.dispose();
    const second = runtime.dispose();
    expect(second).toBe(first);
    await first;

    expect(calls).toEqual(['dependent', 'provider']);
  });

  test('attempts every cleanup and reports aggregate failures', async () => {
    const runtime = new ZeroAppRuntime('failure-test');
    const calls: string[] = [];
    runtime.addCleanup(() => {
      calls.push('first');
      throw new Error('first failed');
    });
    runtime.addCleanup(() => {
      calls.push('second');
      throw new Error('second failed');
    });

    await expect(runtime.dispose()).rejects.toBeInstanceOf(AggregateError);
    expect(calls).toEqual(['second', 'first']);
  });
});
