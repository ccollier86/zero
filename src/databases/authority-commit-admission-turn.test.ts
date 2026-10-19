import { expect, test } from 'bun:test';
import { AuthorityCommitCoordinator } from './authority-commit-coordinator';

test('a synchronous admitted turn keeps FIFO priority but releases each actual commit fence', async () => {
  const coordinator = new AuthorityCommitCoordinator();
  const admission = await coordinator.acquireExclusive();
  const next = coordinator.acquireExclusive();
  let asyncShared!: ReturnType<AuthorityCommitCoordinator['acquireShared']>;
  try {
    expect(coordinator.runSynchronousExclusiveTurn(admission, () => {
      expect(admission.released).toBe(true);
      expect(coordinator.diagnostics().activeExclusive).toBe(false);
      for (let index = 0; index < 3; index++) {
        const writer = coordinator.tryAcquireExclusive();
        expect(writer).not.toBeNull();
        expect(coordinator.tryAcquireShared()).toBeNull();
        writer!.release();
        const projection = coordinator.tryAcquireShared();
        expect(projection).not.toBeNull();
        expect(coordinator.tryAcquireExclusive()).toBeNull();
        projection!.release();
      }
      asyncShared = coordinator.acquireShared();
      expect(coordinator.diagnostics()).toMatchObject({ activeExclusive: false, pendingExclusive: 1, pendingShared: 1 });
      return 'committed';
    })).toBe('committed');
    expect(coordinator.diagnostics()).toMatchObject({ activeExclusive: true, pendingShared: 1 });
    const writer = await next;
    expect(coordinator.tryAcquireShared()).toBeNull();
    writer.release();
    const reader = await asyncShared;
    reader.release();
  } finally { admission.release(); await coordinator.close(); }
});

test('throwing or returning a promise retires the turn and cannot leak its priority', async () => {
  const coordinator = new AuthorityCommitCoordinator();
  for (const operation of [() => { throw new Error('synthetic failure'); }, () => Promise.resolve('invalid')]) {
    const admission = await coordinator.acquireExclusive();
    const next = coordinator.acquireExclusive();
    expect(() => coordinator.runSynchronousExclusiveTurn(admission, operation)).toThrow();
    const lease = await next;
    expect(coordinator.tryAcquireShared()).toBeNull();
    lease.release();
  }
  expect(coordinator.diagnostics()).toMatchObject({ activeShared: 0, activeExclusive: false, pendingExclusive: 0 });
  await coordinator.close();
});

test('an admitted turn cannot be forged, reused, nested or carried across an await', async () => {
  const coordinator = new AuthorityCommitCoordinator();
  const other = new AuthorityCommitCoordinator();
  const admission = await coordinator.acquireExclusive();
  const foreign = await other.acquireExclusive();
  try {
    expect(() => coordinator.runSynchronousExclusiveTurn(foreign, () => {})).toThrow();
    let detached!: Promise<void>;
    coordinator.runSynchronousExclusiveTurn(admission, () => {
      const inner = coordinator.tryAcquireExclusive()!;
      expect(() => coordinator.runSynchronousExclusiveTurn(inner, () => {})).toThrow();
      inner.release();
      detached = Promise.resolve().then(() => { expect(coordinator.tryAcquireShared()).toBeNull(); });
    });
    expect(() => coordinator.runSynchronousExclusiveTurn(admission, () => {})).toThrow();
    const blocker = await coordinator.acquireExclusive();
    try { await detached; } finally { blocker.release(); }
  } finally { admission.release(); foreign.release(); await coordinator.close(); await other.close(); }
});

test('shutdown waits for the synchronous completion phase and leaves no acquired lease behind', async () => {
  const coordinator = new AuthorityCommitCoordinator();
  const admission = await coordinator.acquireExclusive();
  const queued = coordinator.acquireShared().catch(error => error);
  let closed!: Promise<void>;
  coordinator.runSynchronousExclusiveTurn(admission, () => {
    closed = coordinator.close();
    expect(coordinator.diagnostics().state).toBe('draining');
    expect(() => coordinator.tryAcquireShared()).toThrow();
  });
  await closed;
  expect((await queued).code).toBe('DATABASE_CLOSED');
  expect(coordinator.diagnostics()).toMatchObject({ state: 'closed', activeShared: 0, activeExclusive: false });
});
