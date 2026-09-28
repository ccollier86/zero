import { describe, expect, test } from 'bun:test';
import { assertUploadQueueScopeCurrent } from './upload-queue-hooks';

describe('upload queue authorization result boundary', () => {
  test('rejects retained queue handlers during transition and in a replacement scope', () => {
    const requestBoundaryKey = 'scope-a:idle';

    expect(() => assertUploadQueueScopeCurrent(
      requestBoundaryKey,
      true,
      requestBoundaryKey,
    )).not.toThrow();
    expect(() => assertUploadQueueScopeCurrent(
      'scope-a:preparing',
      false,
      requestBoundaryKey,
    )).toThrow('authorization scope changed');
    expect(() => assertUploadQueueScopeCurrent(
      'scope-b:idle',
      true,
      requestBoundaryKey,
    )).toThrow('authorization scope changed');
  });

  test('does not return completed scope-A FileInfo after an async scope switch', async () => {
    const current = { key: 'scope-a:idle', ready: true };
    const requestBoundaryKey = current.key;
    let release!: () => void;
    const wait = new Promise<void>((resolve) => {
      release = resolve;
    });
    const scopeAResults = [{ driveId: 'drive-a', path: 'private-a.pdf' }];

    const completion = wait.then(() => {
      assertUploadQueueScopeCurrent(current.key, current.ready, requestBoundaryKey);
      return scopeAResults;
    });

    current.key = 'scope-b:idle';
    release();

    await expect(completion).rejects.toThrow('authorization scope changed');
  });
});
