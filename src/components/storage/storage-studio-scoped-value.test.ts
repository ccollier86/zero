import { expect, test } from 'bun:test';
import {
  bindStorageStudioValue,
  readStorageStudioValue,
} from './storage-studio-scoped-value';

test('scope-bound values are hidden synchronously before cleanup effects run', () => {
  const previous = bindStorageStudioValue('tenant:one', { secret: 'one' });

  expect(readStorageStudioValue(previous, 'tenant:one', true)).toEqual({ secret: 'one' });
  expect(readStorageStudioValue(previous, 'tenant:two', true)).toBeNull();
  expect(readStorageStudioValue(previous, 'tenant:one', false)).toBeNull();
});
