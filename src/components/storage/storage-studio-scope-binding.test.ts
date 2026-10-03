import { expect, test } from 'bun:test';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import {
  assertStorageStudioScopeCurrent,
  bindStorageStudioScope,
} from './storage-studio-scope-binding';

test('Storage Studio scope binding clears the surface whenever auth is unavailable', () => {
  const calls: string[] = [];
  const surface = {
    setScope: (key: string) => calls.push(`set:${key}`),
    clear: () => calls.push('clear'),
  } as unknown as StorageStudioSdkSurface;

  bindStorageStudioScope(surface, 'tenant:one', true);
  bindStorageStudioScope(surface, 'tenant:one', false);

  expect(calls).toEqual(['set:tenant:one', 'clear']);
});

test('deferred mutations cannot resume after the authorization scope changes', () => {
  expect(() => assertStorageStudioScopeCurrent('tenant:one', 'tenant:one', true))
    .not.toThrow();
  expect(() => assertStorageStudioScopeCurrent('tenant:one', 'tenant:two', true))
    .toThrow('previous authorization scope');
  expect(() => assertStorageStudioScopeCurrent('tenant:one', 'tenant:one', false))
    .toThrow('previous authorization scope');
});
