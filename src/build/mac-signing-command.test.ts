/** Proves bounded owned-process cleanup and sanitized build diagnostics without altering the production signing deadline. */
import { expect, test } from 'bun:test';
import { MemoryEventStore } from '../observability/memory-event-store';
import { emitPlatformCodeTo } from '../observability/sink';
import { runMacSigningCommand } from './mac-signing-command';

function events() {
  const store = new MemoryEventStore();
  const runtime = { sink: store, store, config: { console: false } };
  return { store, emit: (definition: Parameters<typeof emitPlatformCodeTo>[1], options: Parameters<typeof emitPlatformCodeTo>[2]) => emitPlatformCodeTo(runtime, definition, options) };
}

test('spawn failure preserves its local cause but emits only static stage and reason', async () => {
  const { store, emit } = events();
  const cause = new Error('synthetic private host path and signing credential');
  let received: unknown;
  try { await runMacSigningCommand(['/usr/bin/codesign', '/private/synthetic-output'], { emit, spawn: () => { throw cause; } }); }
  catch (error) { received = error; }
  expect(received).toBeInstanceOf(Error);
  expect((received as Error).cause).toBe(cause);
  expect((received as Error).message).toContain('could not start');
  const recorded = store.query().events;
  expect(recorded).toHaveLength(1);
  expect(recorded[0]?.code).toBe('app.compiled_signature.failed');
  expect(recorded[0]?.metadata).toEqual({ stage: 'signing', reason: 'spawn' });
  expect(recorded[0]?.error).toBeUndefined();
  expect(JSON.stringify(recorded)).not.toContain('private');
  expect(JSON.stringify(recorded)).not.toContain('credential');
});

test('nonzero verification exit is a single safe failure event and retains exit evidence', async () => {
  const { store, emit } = events();
  await expect(runMacSigningCommand(['/usr/bin/codesign', '--verify', '--strict', '/private/output'], {
    emit, spawn: () => ({ exited: Promise.resolve(7), kill() {} }),
  })).rejects.toThrow('verification failed');
  expect(store.query().events).toHaveLength(1);
  expect(store.query().events[0]?.metadata).toEqual({ stage: 'verification', reason: 'exit', exitCode: 7 });
});

test('timeout kills once and does not settle until its owned child has been reaped', async () => {
  const { store, emit } = events();
  let resolveExit!: (code: number) => void;
  let resolveKill!: () => void;
  const exited = new Promise<number>(resolve => { resolveExit = resolve; });
  const killed = new Promise<void>(resolve => { resolveKill = resolve; });
  const signals: string[] = [];
  let settled = false;
  const operation = runMacSigningCommand(['/usr/bin/codesign', '/synthetic/output'], {
    deadlineMs: 1, emit, spawn: () => ({ exited, kill(signal) { signals.push(signal); resolveKill(); } }),
  });
  const outcome = operation.then(() => { settled = true; return null; }, error => { settled = true; return error; });
  await killed;
  expect(signals).toEqual(['SIGKILL']);
  expect(settled).toBe(false);
  expect(store.query().events).toHaveLength(0);
  resolveExit(137);
  const error = await outcome;
  expect(error).toBeInstanceOf(Error);
  expect(error.message).toContain('timed out');
  expect(store.query().events).toHaveLength(1);
  expect(store.query().events[0]?.metadata).toEqual({ stage: 'signing', reason: 'timeout', exitCode: 137 });
  await Bun.sleep(5);
  expect(signals).toHaveLength(1);
});

test('success clears the deadline so a completed process is not killed or logged later', async () => {
  const { store, emit } = events();
  let kills = 0;
  await runMacSigningCommand(['/usr/bin/codesign', '/synthetic/output'], {
    deadlineMs: 1, emit, spawn: () => ({ exited: Promise.resolve(0), kill() { kills += 1; } }),
  });
  await Bun.sleep(5);
  expect(kills).toBe(0);
  expect(store.query().events).toHaveLength(0);
});

test('an actual owned Bun process is killed and reaped by the short injected deadline', async () => {
  const { store, emit } = events();
  let child: ReturnType<typeof Bun.spawn> | undefined;
  let reaped = false;
  const signals: string[] = [];
  await expect(runMacSigningCommand([process.execPath, '--no-env-file', '-e', 'setInterval(() => {}, 1000)'], {
    deadlineMs: 25, emit,
    spawn: command => {
      child = Bun.spawn([...command], { stdout: 'ignore', stderr: 'ignore', env: { PATH: Bun.env.PATH ?? '' } });
      return { exited: child.exited.then(code => { reaped = true; return code; }), kill(signal) { signals.push(signal); child!.kill(signal); } };
    },
  })).rejects.toThrow('timed out');
  expect(signals).toEqual(['SIGKILL']);
  expect(reaped).toBe(true);
  expect(child?.signalCode).toBe('SIGKILL');
  expect(store.query().events).toHaveLength(1);
  expect(store.query().events[0]?.metadata?.reason).toBe('timeout');
}, 5_000);
