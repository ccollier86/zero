import { describe, expect, test } from 'bun:test';
import { StorageUploadOperationTracker } from './storage-upload-operation-tracker';

describe('StorageUploadOperationTracker shutdown ownership', () => {
  test('keeps a cooperative-only provider joined when it violates cancellation', async () => {
    const tracker = new StorageUploadOperationTracker();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const operation = tracker.run(async (context) => {
      context.setProviderHandoffSafe(false);
      await blocked;
    });

    let stopped = false;
    const stopping = tracker.stop(5).then((drained) => {
      stopped = true;
      return drained;
    });
    await Bun.sleep(15);
    expect(stopped).toBe(false);
    release();
    await expect(stopping).resolves.toBe(true);
    await operation;
  });

  test('detaches only a durable-publication provider after the bounded wait', async () => {
    const tracker = new StorageUploadOperationTracker();
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const operation = tracker.run(async (context) => {
      context.setProviderHandoffSafe(true);
      await blocked;
    });

    await expect(tracker.stop(5)).resolves.toBe(false);
    release();
    await operation;
    await tracker.whenDrained();
  });
});
