import { expect, test } from 'bun:test';
import {
  AppSignalDispatcher,
  type AppShutdownSignal,
  type AppSignalHost,
} from './app-signal-dispatcher';

test('one signal listener pair joins every app before one process exit', async () => {
  const host = new FakeSignalHost();
  const dispatcher = new AppSignalDispatcher({ host });
  const first = deferred();
  const second = deferred();
  const stopped: string[] = [];
  dispatcher.register(async () => { stopped.push('first'); await first.promise; });
  dispatcher.register(async () => { stopped.push('second'); await second.promise; });

  expect(host.count('SIGINT')).toBe(1);
  expect(host.count('SIGTERM')).toBe(1);
  host.emit('SIGTERM');
  const shutdown = dispatcher.dispatch('SIGINT');
  expect(dispatcher.dispatch('SIGTERM')).toBe(shutdown);
  await Promise.resolve();
  expect(stopped.sort()).toEqual(['first', 'second']);
  expect(host.exits).toEqual([]);
  first.resolve();
  await Promise.resolve();
  expect(host.exits).toEqual([]);
  second.resolve();
  await shutdown;
  expect(host.exits).toEqual([0]);
  expect(host.count('SIGINT')).toBe(0);
  expect(host.count('SIGTERM')).toBe(0);
});

test('normal unregister detaches listeners and failed stop exits only after peers settle', async () => {
  const host = new FakeSignalHost();
  const failures: unknown[] = [];
  const dispatcher = new AppSignalDispatcher({
    host, onFailure: (error) => { failures.push(error); },
  });
  const unregisterFirst = dispatcher.register(() => undefined);
  const unregisterSecond = dispatcher.register(() => undefined);
  unregisterFirst(); unregisterFirst();
  expect(host.count('SIGINT')).toBe(1);
  unregisterSecond();
  expect(host.count('SIGINT')).toBe(0);

  const peer = deferred();
  dispatcher.register(() => Promise.reject(new Error('failed stop')));
  dispatcher.register(() => peer.promise);
  const shutdown = dispatcher.dispatch('SIGINT');
  await Promise.resolve();
  expect(host.exits).toEqual([]);
  peer.resolve();
  await shutdown;
  expect(failures).toHaveLength(1);
  expect(host.exits).toEqual([1]);
});

class FakeSignalHost implements AppSignalHost {
  readonly exits: number[] = [];
  private listeners = new Map<AppShutdownSignal, Set<() => void>>();
  on(signal: AppShutdownSignal, listener: () => void): void {
    const set = this.listeners.get(signal) ?? new Set();
    set.add(listener); this.listeners.set(signal, set);
  }
  off(signal: AppShutdownSignal, listener: () => void): void {
    this.listeners.get(signal)?.delete(listener);
  }
  exit(code: number): void { this.exits.push(code); }
  count(signal: AppShutdownSignal): number { return this.listeners.get(signal)?.size ?? 0; }
  emit(signal: AppShutdownSignal): void {
    for (const listener of this.listeners.get(signal) ?? []) listener();
  }
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => { resolve = done; });
  return { promise, resolve };
}
