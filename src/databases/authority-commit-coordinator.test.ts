import { describe, expect, test } from 'bun:test';

import { AuthorityCommitCoordinator } from './authority-commit-coordinator';
import { DATABASE_OBSERVABILITY_COUNT_MAX } from './database-capacity';
import { DatabaseError } from './database-error';
import { MAX_RUNTIME_TIMER_INTERVAL_MS } from '../runtime/timer-limits';

describe('AuthorityCommitCoordinator', () => {
  test('offers a non-blocking shared lease without bypassing exclusive priority', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const shared = coordinator.tryAcquireShared();
    expect(shared?.mode).toBe('shared');
    const exclusive = coordinator.acquireExclusive();
    expect(coordinator.tryAcquireShared()).toBeNull();
    shared?.release();
    const exclusiveLease = await exclusive;
    expect(coordinator.tryAcquireShared()).toBeNull();
    exclusiveLease.release();
    const next = coordinator.tryAcquireShared();
    expect(next?.mode).toBe('shared');
    next?.release();
    await coordinator.close();
  });

  test('allows concurrent shared leases and gives a queued exclusive lease preference over later shared work', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const first = await coordinator.acquireShared();
    const second = await coordinator.acquireShared();
    let exclusiveGranted = false;
    let lateSharedGranted = false;
    const exclusivePromise = coordinator.acquireExclusive().then((lease) => {
      exclusiveGranted = true;
      return lease;
    });
    const lateSharedPromise = coordinator.acquireShared().then((lease) => {
      lateSharedGranted = true;
      return lease;
    });

    await flushMicrotasks();
    expect(exclusiveGranted).toBe(false);
    expect(lateSharedGranted).toBe(false);
    expect(coordinator.diagnostics()).toMatchObject({
      activeShared: 2,
      activeExclusive: false,
      pendingShared: 1,
      pendingExclusive: 1,
    });

    first.release();
    first.release();
    await flushMicrotasks();
    expect(exclusiveGranted).toBe(false);
    second.release();

    const exclusive = await exclusivePromise;
    expect(exclusive.mode).toBe('exclusive');
    expect(lateSharedGranted).toBe(false);
    exclusive.release();
    exclusive.release();
    expect(exclusive.released).toBe(true);

    const lateShared = await lateSharedPromise;
    expect(lateShared.mode).toBe('shared');
    lateShared.release();
    await coordinator.close();
  });

  test('preserves arrivals already ahead of a later exclusive waiter', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const activeExclusive = await coordinator.acquireExclusive();
    const order: string[] = [];
    const earlierSharedPromise = coordinator.acquireShared().then((lease) => {
      order.push('earlier-shared');
      return lease;
    });
    const exclusivePromise = coordinator.acquireExclusive().then((lease) => {
      order.push('exclusive');
      return lease;
    });
    const laterSharedPromise = coordinator.acquireShared().then((lease) => {
      order.push('later-shared');
      return lease;
    });

    activeExclusive.release();
    const earlierShared = await earlierSharedPromise;
    await flushMicrotasks();
    expect(order).toEqual(['earlier-shared']);

    earlierShared.release();
    const exclusive = await exclusivePromise;
    expect(order).toEqual(['earlier-shared', 'exclusive']);

    exclusive.release();
    const laterShared = await laterSharedPromise;
    expect(order).toEqual([
      'earlier-shared',
      'exclusive',
      'later-shared',
    ]);
    laterShared.release();
    await coordinator.drain();
  });

  test('removing an aborted exclusive barrier admits queued shared work', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const activeShared = await coordinator.acquireShared();
    const controller = new AbortController();
    const exclusiveError = observeDatabaseError(coordinator.acquireExclusive({
      signal: controller.signal,
    }));
    const laterSharedPromise = coordinator.acquireShared();

    controller.abort(new Error('must not cross the safe error boundary'));
    const error = await exclusiveError;
    expect(error).toMatchObject({
      code: 'DATABASE_QUEUE_TIMEOUT',
      retryable: true,
      outcome: 'not-started',
      details: { reason: 'aborted' },
    });
    expect(error.message).not.toContain('must not cross');

    const laterShared = await laterSharedPromise;
    expect(coordinator.diagnostics().activeShared).toBe(2);
    laterShared.release();
    activeShared.release();
    await coordinator.close();
  });

  test('rejects an already-aborted acquisition without consuming queue capacity', async () => {
    const coordinator = new AuthorityCommitCoordinator({ maxPending: 1 });
    const activeExclusive = await coordinator.acquireExclusive();
    const controller = new AbortController();
    controller.abort();

    const error = await observeDatabaseError(coordinator.acquireShared({
      signal: controller.signal,
    }));
    expect(error.code).toBe('DATABASE_QUEUE_TIMEOUT');
    expect(coordinator.diagnostics().pendingShared).toBe(0);

    const pending = coordinator.acquireShared();
    activeExclusive.release();
    const lease = await pending;
    lease.release();
    await coordinator.close();
  });

  test('times out only the queued acquisition and removes its writer barrier', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const activeShared = await coordinator.acquireShared();
    const exclusiveError = observeDatabaseError(coordinator.acquireExclusive({
      timeoutMs: 1,
    }));
    const laterSharedPromise = coordinator.acquireShared();

    const error = await exclusiveError;
    expect(error).toMatchObject({
      code: 'DATABASE_QUEUE_TIMEOUT',
      retryable: true,
      outcome: 'not-started',
      details: {
        reason: 'deadline-exceeded',
        timeoutMs: 1,
      },
    });

    const laterShared = await laterSharedPromise;
    expect(coordinator.diagnostics().activeShared).toBe(2);
    laterShared.release();
    activeShared.release();
    await coordinator.close();
  });

  test('bounds the pending queue with the stable backpressure error', async () => {
    const coordinator = new AuthorityCommitCoordinator({ maxPending: 1 });
    const activeExclusive = await coordinator.acquireExclusive();
    const firstPending = coordinator.acquireShared();

    const error = await observeDatabaseError(coordinator.acquireExclusive());
    expect(error).toMatchObject({
      code: 'DATABASE_BACKPRESSURE',
      retryable: true,
      outcome: 'not-started',
      details: { maxPending: 1 },
    });
    expect(coordinator.diagnostics()).toMatchObject({
      pendingShared: 1,
      pendingExclusive: 0,
    });

    activeExclusive.release();
    const shared = await firstPending;
    shared.release();
    await coordinator.close();
  });

  test('offers a non-waiting exclusive commit fence without bypassing existing priority', async () => {
    const coordinator = new AuthorityCommitCoordinator();

    const immediate = coordinator.tryAcquireExclusive();
    expect(immediate?.mode).toBe('exclusive');
    expect(coordinator.tryAcquireExclusive()).toBeNull();
    immediate?.release();

    const shared = await coordinator.acquireShared();
    expect(coordinator.tryAcquireExclusive()).toBeNull();
    const waitingExclusive = coordinator.acquireExclusive();
    shared.release();
    const queued = await waitingExclusive;
    expect(coordinator.tryAcquireExclusive()).toBeNull();
    queued.release();

    const final = coordinator.tryAcquireExclusive();
    expect(final?.mode).toBe('exclusive');
    final?.release();
    await coordinator.close();
    expect(() => coordinator.tryAcquireExclusive()).toThrow(DatabaseError);
  });

  test('drain rejects queued work but waits for granted leases without releasing them', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const granted = await coordinator.acquireShared();
    const pendingExclusiveError = observeDatabaseError(
      coordinator.acquireExclusive(),
    );
    const pendingSharedError = observeDatabaseError(coordinator.acquireShared());
    let drained = false;
    const drainPromise = coordinator.drain().then(() => {
      drained = true;
    });

    const [exclusiveError, sharedError] = await Promise.all([
      pendingExclusiveError,
      pendingSharedError,
    ]);
    expect(exclusiveError.code).toBe('DATABASE_CLOSED');
    expect(sharedError.code).toBe('DATABASE_CLOSED');
    await flushMicrotasks();
    expect(drained).toBe(false);
    expect(granted.released).toBe(false);
    expect(coordinator.diagnostics()).toMatchObject({
      state: 'draining',
      activeShared: 1,
      pendingShared: 0,
      pendingExclusive: 0,
    });

    const closedAcquireError = await observeDatabaseError(
      coordinator.acquireShared({ timeoutMs: 0 }),
    );
    expect(closedAcquireError.code).toBe('DATABASE_CLOSED');
    granted.release();
    granted.release();
    await drainPromise;
    expect(granted.released).toBe(true);
    expect(coordinator.diagnostics().state).toBe('closed');
    await coordinator.close();
  });

  test('an abort after a lease is granted does not implicitly release it', async () => {
    const coordinator = new AuthorityCommitCoordinator();
    const controller = new AbortController();
    const lease = await coordinator.acquireShared({ signal: controller.signal });

    controller.abort();
    expect(lease.released).toBe(false);
    expect(coordinator.diagnostics().activeShared).toBe(1);

    let drained = false;
    const drainPromise = coordinator.close().then(() => {
      drained = true;
    });
    await flushMicrotasks();
    expect(drained).toBe(false);
    lease.release();
    await drainPromise;
  });

  test('rejects invalid queue configuration and per-acquisition deadlines', async () => {
    expect(() => new AuthorityCommitCoordinator({ maxPending: 0 })).toThrow(
      DatabaseError,
    );
    expect(() => new AuthorityCommitCoordinator({ acquireTimeoutMs: -1 }))
      .toThrow(DatabaseError);
    expect(() => new AuthorityCommitCoordinator({
      maxPending: DATABASE_OBSERVABILITY_COUNT_MAX + 1,
    })).toThrow(DatabaseError);
    expect(() => new AuthorityCommitCoordinator({
      acquireTimeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS + 1,
    })).toThrow(DatabaseError);

    const coordinator = new AuthorityCommitCoordinator();
    const error = await observeDatabaseError(coordinator.acquireShared({
      timeoutMs: Number.POSITIVE_INFINITY,
    }));
    expect(error).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
      details: { option: 'timeoutMs' },
    });
    const oversized = await observeDatabaseError(coordinator.acquireShared({
      timeoutMs: MAX_RUNTIME_TIMER_INTERVAL_MS + 1,
    }));
    expect(oversized).toMatchObject({
      code: 'DATABASE_CONFIG_INVALID',
      retryable: false,
      outcome: 'not-started',
      details: { option: 'timeoutMs' },
    });
    await coordinator.close();
  });

  test('closes immediately when idle and returns one stable drain promise', async () => {
    const coordinator = new AuthorityCommitCoordinator({
      maxPending: 7,
      acquireTimeoutMs: 11,
    });
    const first = coordinator.drain();
    const second = coordinator.close();

    expect(second).toBe(first);
    await first;
    expect(coordinator.diagnostics()).toEqual({
      state: 'closed',
      activeShared: 0,
      activeExclusive: false,
      pendingShared: 0,
      pendingExclusive: 0,
      maxPending: 7,
      acquireTimeoutMs: 11,
    });
  });
});

async function observeDatabaseError(
  promise: Promise<unknown>,
): Promise<DatabaseError> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(DatabaseError);
    return error as DatabaseError;
  }
  throw new Error('Expected a DatabaseError rejection.');
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}
