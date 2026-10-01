import { describe, expect, test } from 'bun:test';
import { isAdminUserRecordCallbackCurrent } from './use-admin-user-record';

describe('admin user record callback boundary', () => {
  test('rejects delayed reload and retained replace callbacks after A changes to B', async () => {
    const live = {
      boundaryKey: 'scope-1',
      boundaryReady: true,
      userId: 'user-a' as string | null,
      enabled: true,
    };
    const callbackBoundaryKey = live.boundaryKey;
    let renderedUserId = 'user-a';
    let release!: (userId: string) => void;
    const response = new Promise<string>((resolve) => {
      release = resolve;
    });
    const canPublish = (targetUserId: string) => isAdminUserRecordCallbackCurrent({
      currentBoundaryKey: live.boundaryKey,
      boundaryReady: live.boundaryReady,
      callbackBoundaryKey,
      currentUserId: live.userId,
      targetUserId,
      enabled: live.enabled,
    });

    const delayedReloadForA = response.then((userId) => {
      if (canPublish('user-a')) renderedUserId = userId;
    });
    const retainedReplaceForA = (userId: string) => {
      if (userId === 'user-a' && canPublish('user-a')) renderedUserId = userId;
    };

    live.userId = 'user-b';
    renderedUserId = 'user-b';
    retainedReplaceForA('user-a');
    release('user-a');
    await delayedReloadForA;

    expect(renderedUserId).toBe('user-b');
    expect(canPublish('user-a')).toBe(false);
    expect(canPublish('user-b')).toBe(true);

    live.boundaryKey = 'scope-2';
    expect(canPublish('user-b')).toBe(false);
  });
});
