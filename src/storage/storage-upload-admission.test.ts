import { describe, expect, test } from 'bun:test';
import {
  runWithStorageUploadHeartbeat,
  type StorageUploadLease,
} from './storage-upload-admission';

describe('storage upload admission heartbeat', () => {
  test('renews throughout stalled adapter work and stops after settlement', async () => {
    let release!: () => void;
    const blocked = new Promise<string>((resolve) => { release = () => resolve('written'); });
    let heartbeats = 0;
    let observeSecondHeartbeat!: () => void;
    const secondHeartbeat = new Promise<void>((resolve) => {
      observeSecondHeartbeat = resolve;
    });
    let settled = false;
    let observePostSettlementHeartbeat!: () => void;
    const postSettlementHeartbeat = new Promise<void>((resolve) => {
      observePostSettlementHeartbeat = resolve;
    });
    const lease = leaseFixture(() => {
      heartbeats += 1;
      if (heartbeats === 2) observeSecondHeartbeat();
      if (settled) observePostSettlementHeartbeat();
    });

    const running = runWithStorageUploadHeartbeat(lease, () => blocked, 5);
    await mustSettle(secondHeartbeat, 'second upload heartbeat');
    expect(heartbeats).toBeGreaterThanOrEqual(2);
    release();
    expect(await running).toBe('written');
    settled = true;
    const settledHeartbeats = heartbeats;
    const heartbeatAfterSettlement = await Promise.race([
      postSettlementHeartbeat.then(() => true),
      Bun.sleep(25).then(() => false),
    ]);
    expect(heartbeatAfterSettlement).toBeFalse();
    expect(heartbeats).toBe(settledHeartbeats);
  });

  test('fails publication when durable reservation renewal fails', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const failure = new Error('reservation expired');
    let observeHeartbeat!: () => void;
    const heartbeatAttempted = new Promise<void>((resolve) => {
      observeHeartbeat = resolve;
    });
    const lease = leaseFixture(() => {
      observeHeartbeat();
      throw failure;
    });

    const running = runWithStorageUploadHeartbeat(lease, () => blocked, 5);
    await mustSettle(heartbeatAttempted, 'failed upload heartbeat');
    release();
    await expect(running).rejects.toBe(failure);
  });
});

function leaseFixture(heartbeat: () => void): StorageUploadLease {
  return {
    adjust() {},
    heartbeat,
    assertCurrent() {},
    commit() {},
    release() {},
  };
}

async function mustSettle(operation: Promise<void>, label: string): Promise<void> {
  await Promise.race([
    operation,
    Bun.sleep(2_000).then(() => {
      throw new Error(`Timed out waiting for ${label}.`);
    }),
  ]);
}
