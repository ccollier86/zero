import { describe, expect, it } from 'bun:test';
import type {
  DataRealmReadinessSdkSurface,
  DataRealmReadinessSnapshot,
} from '../../auth/data-realm-readiness-types';
import {
  dataRealmReadinessPollOperation,
  retainDataRealmReadinessSnapshotAfterFailure,
} from './data-realm-readiness-hooks';

describe('data realm readiness recovery polling', () => {
  it('advances provisioning through automatic retry to ready', async () => {
    const calls: string[] = [];
    const sdk: DataRealmReadinessSdkSurface = {
      getReadiness: async () => {
        calls.push('inspect');
        return snapshot('provisioning');
      },
      retry: async () => {
        calls.push('retry');
        return snapshot('ready');
      },
    };

    let current = await sdk.getReadiness();
    expect(dataRealmReadinessPollOperation(current)).toBe('retry');
    current = await runOperation(sdk, dataRealmReadinessPollOperation(current));

    expect(current.status).toBe('ready');
    expect(calls).toEqual(['inspect', 'retry']);
  });

  it('retains a pending snapshot so a transient retry failure can recover', async () => {
    let attempts = 0;
    const sdk: DataRealmReadinessSdkSurface = {
      getReadiness: async () => snapshot('provisioning'),
      retry: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('transient transport failure');
        return snapshot('ready');
      },
    };

    let current: DataRealmReadinessSnapshot | null = await sdk.getReadiness();
    const operation = dataRealmReadinessPollOperation(current);
    try {
      current = await runOperation(sdk, operation);
    } catch {
      current = retainDataRealmReadinessSnapshotAfterFailure(operation, current);
    }

    expect(current?.status).toBe('provisioning');
    expect(dataRealmReadinessPollOperation(current!)).toBe('retry');
    current = await runOperation(sdk, dataRealmReadinessPollOperation(current!));
    expect(current.status).toBe('ready');
    expect(attempts).toBe(2);
  });

  it('does not loop a terminal failure after its retry transport fails', () => {
    expect(retainDataRealmReadinessSnapshotAfterFailure(
      'retry',
      snapshot('failed'),
    )).toBeNull();
  });
});

function snapshot(
  status: 'provisioning' | 'ready' | 'failed',
): DataRealmReadinessSnapshot {
  return Object.freeze({
    status,
    scope: 'tenant',
    pendingOperations: status === 'provisioning' ? 1 : 0,
    retryable: status === 'failed',
    errorCode: status === 'failed' ? 'IDENTITY_PROJECTION_NOT_READY' : null,
    updatedAt: 42,
    pollAfterMs: status === 'provisioning' ? 250 : null,
  });
}

function runOperation(
  sdk: DataRealmReadinessSdkSurface,
  operation: 'inspect' | 'retry',
): Promise<DataRealmReadinessSnapshot> {
  return operation === 'retry' ? sdk.retry() : sdk.getReadiness();
}
