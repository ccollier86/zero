import { describe, expect, test } from 'bun:test';

import { withAuthRefreshLock } from './auth-refresh-coordinator';

describe('auth refresh coordinator', () => {
  test('serializes same-server refresh work in runtimes without Web Locks', async () => {
    const order: string[] = [];
    let releaseFirst!: () => void;
    let markFirstEntered!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstEntered = new Promise<void>((resolve) => {
      markFirstEntered = resolve;
    });

    const first = withAuthRefreshLock('https://zero.example', async () => {
      order.push('first:start');
      markFirstEntered();
      await firstGate;
      order.push('first:end');
      return 1;
    });
    const second = withAuthRefreshLock('https://zero.example/', async () => {
      order.push('second:start');
      order.push('second:end');
      return 2;
    });

    await firstEntered;
    expect(order).toEqual(['first:start']);
    releaseFirst();

    await expect(Promise.all([first, second])).resolves.toEqual([1, 2]);
    expect(order).toEqual([
      'first:start',
      'first:end',
      'second:start',
      'second:end',
    ]);
  });

  test('does not serialize different Zero servers together', async () => {
    const entered: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });

    const first = withAuthRefreshLock('https://one.example', async () => {
      entered.push('one');
      await gate;
    });
    const second = withAuthRefreshLock('https://two.example', async () => {
      entered.push('two');
    });

    await Promise.resolve();
    await second;
    expect(entered).toEqual(['one', 'two']);
    release();
    await first;
  });
});
