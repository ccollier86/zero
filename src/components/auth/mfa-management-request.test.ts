/** Deferred-result admission proof, without a browser/provider or method transport. */
import { expect, test } from 'bun:test';
import { MfaManagementRequestLifecycle } from './mfa-management-request';
import { AuthorizationScopeBoundaryFence } from '../../frontend/client/authorization-scope-hooks';

test('unmounted or unavailable scopes cannot admit a request', () => {
  let current = true;
  const lifecycle = new MfaManagementRequestLifecycle(() => current);
  expect(lifecycle.begin()).toBeNull();
  lifecycle.activate();
  const admitted = lifecycle.begin();
  expect(admitted?.()).toBe(true);
  current = false;
  expect(admitted?.()).toBe(false);
  expect(lifecycle.begin()).toBeNull();
  current = true;
  lifecycle.retire();
  expect(admitted?.()).toBe(false);
  expect(lifecycle.begin()).toBeNull();
});

test('a later request supersedes an earlier result, while StrictMode reactivation cannot revive it', () => {
  const lifecycle = new MfaManagementRequestLifecycle(() => true);
  lifecycle.activate();
  const original = lifecycle.begin(), latest = lifecycle.begin();
  expect(original?.()).toBe(false);
  expect(latest?.()).toBe(true);
  lifecycle.retire(); lifecycle.activate();
  expect(latest?.()).toBe(false);
  expect(lifecycle.begin()?.()).toBe(true);
});

test('scope replacement before a held response resolves cannot publish or dispatch a retained retry', async () => {
  let scope = 'original';
  const lifecycle = new MfaManagementRequestLifecycle(() => scope === 'original');
  lifecycle.activate();
  const admitted = lifecycle.begin();
  if (!admitted) throw new Error('Expected the original synthetic scope to admit.');
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  let published = false;
  const request = held.then(() => { if (admitted()) published = true; });
  scope = 'replacement'; release(); await request;
  expect(published).toBe(false);
  expect(lifecycle.begin()).toBeNull();
});

test('a config cycle back to the same capability cannot revive an old request before cleanup', () => {
  const fence = new AuthorizationScopeBoundaryFence();
  const captured = fence.update('enabled');
  const lifecycle = new MfaManagementRequestLifecycle(() => fence.isCurrent(captured));
  lifecycle.activate();
  const original = lifecycle.begin();
  expect(original?.()).toBe(true);
  fence.update('loading'); fence.update('enabled');
  expect(original?.()).toBe(false);
  expect(lifecycle.begin()).toBeNull();
});
