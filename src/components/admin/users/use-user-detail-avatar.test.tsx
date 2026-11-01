/** Selected-avatar hook ownership and cancellation. Native HTTP/image rendering is qualified separately in the browser test. */
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UserAvatarAsset, UserAvatarSnapshot } from '../../../auth/auth-user-avatar-types';
import { normalizeAuthUserAvatar } from '../../../auth/auth-config-user-avatar';
import { AuthClientError } from '../../../frontend/client/auth-errors';
import { ClientProvider } from '../../../frontend/client/client-context';
import type { Client } from '../../../frontend/client/sdk';
import { configureFrontendObservability } from '../../../frontend/client/observability';
import { createHookContainer, installMinimalHookDom } from '../../../frontend/client/test-fixtures/react-hook-dom';
import type { UserManagementUser } from './user-management-types';
import { useUserDetailAvatar } from './use-user-detail-avatar';

const roots = new Set<Root>();
let restoreDom: () => void;
let revoke: ReturnType<typeof spyOn<typeof URL, 'revokeObjectURL'>>;
beforeEach(() => {
  restoreDom = installMinimalHookDom();
  revoke = spyOn(URL, 'revokeObjectURL');
  configureFrontendObservability({ console: false, http: false });
});
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear(); revoke.mockRestore(); restoreDom();
});

test('selected-account photos use the directory facade, follow accepted changes and remove to initials', async () => {
  const f = await fixture();
  expect(f.reads.map(read => read.userId)).toEqual(['peer']);
  expect(f.imageUrl).toStartWith('blob:');
  const previous = f.imageUrl!;
  await act(async () => f.emit('operator', null));
  expect(f.reads).toHaveLength(1);
  await act(async () => f.emit('peer', photo('2')));
  expect(f.imageUrl).toStartWith('blob:'); expect(f.imageUrl).not.toBe(previous);
  expect(revoke.mock.calls.some(([url]) => url === previous)).toBe(true);
  await act(async () => f.emit('peer', null));
  expect(f.imageUrl).toBeNull();
});

test('selection changes abort old metadata and a late reply cannot relabel the new account', async () => {
  const f = await fixture(), held = deferred<Directory>();
  const previous = f.imageUrl!;
  f.holdRead(held.promise);
  await f.select('peer', 2);
  const pending = f.reads.at(-1)!;
  await f.select('no-photo');
  expect(pending.signal.aborted).toBe(true); expect(f.imageUrl).toBeNull();
  const deliveries = f.deliveries;
  await act(async () => held.resolve({ userId: 'peer', displayName: 'Peer', asset: photo('1') }));
  expect(f.imageUrl).toBeNull(); expect(f.deliveries).toBe(deliveries);
  expect(revoke.mock.calls.some(([url]) => url === previous)).toBe(true);
});

test('late bytes are fenced against live authority before React notification; unmount retires listeners and URLs', async () => {
  const f = await fixture(), held = deferred<Blob>(), previous = f.imageUrl!;
  f.holdDelivery(held.promise);
  await act(async () => f.emit('peer', photo('2')));
  f.auth.authorizationScopeKey = 'replacement-scope';
  f.auth.isAuthenticated = false;
  await act(async () => held.resolve(new Blob(['private synthetic bytes'], { type: 'image/webp' })));
  expect(f.imageUrl).toBe(previous);
  await act(async () => f.notify());
  expect(f.imageUrl).toBeNull();
  expect(revoke.mock.calls.some(([url]) => url === previous)).toBe(true);
  await act(async () => f.root.unmount()); roots.delete(f.root);
  expect(f.listenerCount()).toBe(0);
  expect(f.reads.every(read => read.signal.aborted)).toBe(true);
});

test('an unavailable private photo keeps the ordinary identity fallback', async () => {
  const f = await fixture();
  f.holdRead(Promise.reject(new AuthClientError('Private directory is unavailable', 404, 'AUTH_AVATAR_IMAGE_UNAVAILABLE', null)));
  await f.select('unavailable');
  expect(f.imageUrl).toBeNull();
});

test('an auth-disabled controlled manager keeps initials without subscribing to private avatars', async () => {
  const f = await fixture(false);
  expect(f.imageUrl).toBeNull(); expect(f.reads).toHaveLength(0);
  expect(f.listenerCount()).toBe(0);
});

type Directory = { userId: string; displayName: string; asset: UserAvatarAsset | null };
function photo(suffix: string): UserAvatarAsset {
  const id = `ava_00000000-0000-0000-0000-00000000000${suffix}`;
  return { id, width: 64, height: 64, byteLength: 3, mimeType: 'image/webp', deliveryPath: `/auth/profile/avatar/assets/${id}` };
}
function account(userId: string, updatedAt: number | null = null): UserManagementUser {
  return { id: userId, userId, username: userId, email: `${userId}@example.test`, firstName: '', lastName: '', role: 'user',
    status: 'active', passwordChangeRequired: false, emailVerifiedAt: null, emailVerificationRequired: false, mfaRequired: false,
    properties: {}, createdAt: 1, updatedAt };
}
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(yes => { resolve = yes; }), resolve }; }
async function fixture(authEnabled = true) {
  const listeners = new Set<() => void>(), photoListeners = new Set<(snapshot: UserAvatarSnapshot) => void>();
  const auth = { user: { userId: 'operator' }, authorizationScopeKey: 'original-scope', activeTenant: null,
    isLoading: false, isRestoring: false, isAuthenticated: true, sessionTransition: { phase: 'idle', revision: 0 },
    authorizationState: { status: 'ready' }, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const entries = new Map<string, UserAvatarAsset | null>([['peer', photo('1')]]);
  const reads: { userId: string; signal: AbortSignal }[] = [];
  let read: Promise<Directory> | undefined, delivery: Promise<Blob> | undefined, deliveries = 0;
  const client = { auth: authEnabled ? auth : null, userAvatar: {
    subscribe(fn: (snapshot: UserAvatarSnapshot) => void) { photoListeners.add(fn); return () => { photoListeners.delete(fn); }; },
    async directory(userId: string, signal: AbortSignal) {
      reads.push({ userId, signal });
      const pending = read; read = undefined;
      return pending ?? { userId, displayName: userId, asset: entries.get(userId) ?? null };
    },
    async deliver() { deliveries++; const pending = delivery; delivery = undefined; return pending ?? new Blob(['img'], { type: 'image/webp' }); },
  } } as unknown as Client;
  let imageUrl: string | null = null, select!: (user: UserManagementUser) => void;
  function Capture() {
    const [user, setUser] = useState(account('peer')); select = setUser;
    imageUrl = useUserDetailAvatar(user); return null;
  }
  const root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) })));
  return { root, auth, reads, get imageUrl() { return imageUrl; }, get deliveries() { return deliveries; },
    holdRead(value: Promise<Directory>) { read = value; }, holdDelivery(value: Promise<Blob>) { delivery = value; },
    select: async (id: string, revision?: number) => { await act(async () => select(account(id, revision))); },
    notify() { for (const listener of listeners) listener(); }, listenerCount: () => photoListeners.size,
    emit(userId: string, asset: UserAvatarAsset | null) {
      entries.set(userId, asset);
      for (const listener of photoListeners) listener({ userId, asset, revision: 2, capabilities: { ...normalizeAuthUserAvatar(true), state: 'ready' } });
    },
  };
}
