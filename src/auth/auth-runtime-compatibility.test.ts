import { describe, expect, test } from 'bun:test';

import { createEmailRuntime } from '../email/runtime';
import { createReactiveDB } from '../sync/reactive-db';
import { resolveAuthBehaviorConfig } from './auth-config';
import { AuthRuntime } from './auth-runtime';
import { getAuthRuntimeContext } from './auth-runtime-compatibility';

describe('auth runtime compatibility context', () => {
  test('keeps the empty compatibility context in exact key parity with AuthRuntime', async () => {
    const db = createReactiveDB({ mode: 'memory' });
    const runtime = new AuthRuntime(
      { db },
      resolveAuthBehaviorConfig(),
      {
        getEmailRuntime: () => createEmailRuntime(false, {}),
        getPlatformTokenService: () => null,
      },
    );

    try {
      const emptyContext = getAuthRuntimeContext();
      expect(Object.keys(emptyContext)).toEqual(Object.keys(runtime.getContext()));
      expect(Object.values(emptyContext).every((value) => value === null)).toBe(true);
    } finally {
      await runtime.stop();
      db.dispose();
    }
  });
});
