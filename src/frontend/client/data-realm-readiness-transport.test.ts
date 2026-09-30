import { describe, expect, it } from 'bun:test';
import {
  DATA_REALM_READINESS_PATH,
  DATA_REALM_READINESS_RETRY_PATH,
  createDataRealmReadinessSdkSurface,
} from './data-realm-readiness-transport';

const READY = Object.freeze({
  status: 'ready' as const,
  scope: 'tenant' as const,
  pendingOperations: 0,
  retryable: false,
  errorCode: null,
  updatedAt: 42,
  pollAfterMs: null,
});

describe('data realm readiness SDK transport', () => {
  it('uses authenticated client fetch without accepting a target selector', async () => {
    const calls: Array<{ path: string; init: unknown }> = [];
    const sdk = createDataRealmReadinessSdkSurface(async (path, init) => {
      calls.push({ path, init });
      return READY;
    });
    const signal = new AbortController().signal;

    await expect(sdk.getReadiness(signal)).resolves.toEqual(READY);
    await expect(sdk.retry(signal)).resolves.toEqual(READY);
    expect(calls).toEqual([
      { path: DATA_REALM_READINESS_PATH, init: { method: 'GET', signal } },
      { path: DATA_REALM_READINESS_RETRY_PATH, init: { method: 'POST', signal } },
    ]);
  });

  it('rejects malformed server output at the browser boundary', async () => {
    const sdk = createDataRealmReadinessSdkSurface(async () => ({
      ...READY,
      scope: '/private/data/tenant.sqlite',
    }));

    await expect(sdk.getReadiness()).rejects.toMatchObject({
      code: 'DATA_REALM_READINESS_INVALID',
    });
  });
});
