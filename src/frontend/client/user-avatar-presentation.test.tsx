/** No files, servers or browser builds: mounted preview ownership and retirement only. */
import { afterEach, beforeEach, expect, spyOn, test } from 'bun:test';
import { act, createElement, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { UserAvatarAsset, UserAvatarPresentation } from '../../auth/auth-user-avatar-types';
import { ClientProvider } from './client-context';
import type { Client } from './sdk';
import { createHookContainer, installMinimalHookDom } from './test-fixtures/react-hook-dom';
import { useUserAvatarPresentation } from './user-avatar-presentation';

const roots = new Set<Root>();
let restoreDom: () => void, sequence = 0;
let create: ReturnType<typeof spyOn<typeof URL, 'createObjectURL'>>;
let revoke: ReturnType<typeof spyOn<typeof URL, 'revokeObjectURL'>>;
beforeEach(() => {
  restoreDom = installMinimalHookDom(); sequence = 0;
  create = spyOn(URL, 'createObjectURL').mockImplementation(() => `blob:private-fixture-${++sequence}`);
  revoke = spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
});
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount()); roots.clear();
  create.mockRestore(); revoke.mockRestore(); restoreDom();
});

test('an admitted mounted peer uses authenticated delivery only; equivalent projections do not refetch', async () => {
  const f = await fixture();
  expect(f.imageUrl).toBe('blob:private-fixture-1');
  expect(f.reads).toHaveLength(1); expect(f.reads[0]!.asset).toEqual(photo());
  expect(f.directoryReads).toBe(0);
  await f.set('peer', { revision: 1, asset: photo() });
  expect(f.reads).toHaveLength(1); expect(create).toHaveBeenCalledTimes(1);
});

test('a newer revision refreshes a reused asset path and remove/denial retire its bytes to initials', async () => {
  const f = await fixture(), first = f.imageUrl!, pending = deferred<Blob>();
  f.hold(pending.promise);
  await f.set('peer', { revision: 2, asset: photo() });
  expect(f.imageUrl).toBeNull(); expect(f.reads[0]!.signal.aborted).toBe(true);
  expect(revoke.mock.calls.some(([url]) => url === first)).toBe(true);
  await act(async () => pending.resolve(bytes()));
  const replacement = f.imageUrl!; expect(replacement).not.toBe(first);
  await f.set('peer', { revision: 3, asset: null });
  expect(f.imageUrl).toBeNull(); expect(revoke.mock.calls.some(([url]) => url === replacement)).toBe(true);
  await f.set('peer', null); expect(f.imageUrl).toBeNull(); expect(f.reads).toHaveLength(2);
});

test('late subject/projection bytes cannot replace a new preview or survive an explicit denial', async () => {
  const pending = deferred<Blob>(), f = await fixture(pending.promise);
  expect(f.imageUrl).toBeNull();
  await f.set('different-peer', { revision: 1, asset: photo('2') });
  const accepted = f.imageUrl!;
  expect(f.reads[0]!.signal.aborted).toBe(true);
  await act(async () => pending.resolve(bytes()));
  expect(f.imageUrl).toBe(accepted); expect(create).toHaveBeenCalledTimes(1);
  const denied = deferred<Blob>(); f.hold(denied.promise);
  await f.set('different-peer', { revision: 2, asset: photo('2') });
  await f.set('different-peer', null);
  await act(async () => denied.resolve(bytes()));
  expect(f.imageUrl).toBeNull(); expect(create).toHaveBeenCalledTimes(1);
});

test('auth publication synchronously aborts and revokes before a replacement React commit', async () => {
  const f = await fixture(), previous = f.imageUrl!;
  await act(async () => {
    f.auth.authorizationScopeKey = 'replacement-account'; f.auth.user = { userId: 'replacement' };
    f.auth.isAuthenticated = false; f.notify();
    expect(f.reads[0]!.signal.aborted).toBe(true);
    expect(revoke.mock.calls.some(([url]) => url === previous)).toBe(true);
  });
  expect(f.imageUrl).toBeNull();
});

test('same-account authorization-data retirement and tenant replacement cannot retain a loaded preview', async () => {
  const f = await fixture(), previous = f.imageUrl!;
  await act(async () => {
    f.dataBoundary.revision++;
    f.notify();
    expect(f.reads[0]!.signal.aborted).toBe(true);
    expect(revoke.mock.calls.some(([url]) => url === previous)).toBe(true);
  });
  expect(f.imageUrl).not.toBe(previous);
  const next = f.imageUrl!;
  await act(async () => {
    f.auth.activeTenant = { tenantId: 'replacement-tenant' }; f.notify();
    expect(revoke.mock.calls.some(([url]) => url === next)).toBe(true);
  });
  expect(f.imageUrl).not.toBe(next);
});

test('live scope checks reject late bytes even before auth notifies React and never reuse them after return', async () => {
  const pending = deferred<Blob>(), f = await fixture(pending.promise);
  f.auth.authorizationScopeKey = 'retired-without-notification';
  await act(async () => pending.resolve(bytes()));
  expect(f.imageUrl).toBeNull(); expect(create).not.toHaveBeenCalled();
  await act(async () => { f.auth.isAuthenticated = false; f.notify(); });
  await act(async () => { f.auth.isAuthenticated = true; f.auth.authorizationScopeKey = 'initial'; f.notify(); });
  expect(f.reads).toHaveLength(2); expect(f.imageUrl).toBe('blob:private-fixture-1');
});

test('delivery rejection and unavailable projections never retain an earlier photo; unmount owns cleanup', async () => {
  const f = await fixture();
  f.hold(Promise.reject(new Error('Synthetic forbidden photo')));
  await f.set('peer', { revision: 2, asset: photo('2') });
  expect(f.imageUrl).toBeNull();
  await f.set('peer', { revision: 3, asset: photo('2') });
  const final = f.imageUrl!;
  await act(async () => f.root.unmount()); roots.delete(f.root);
  expect(f.listeners.size).toBe(0); expect(f.reads.every(read => read.signal.aborted)).toBe(true);
  expect(revoke.mock.calls.some(([url]) => url === final)).toBe(true);
});

test('auth-disabled/custom hosts and invalid descriptors use initials without requesting bytes', async () => {
  const f = await fixture(undefined, false);
  expect(f.imageUrl).toBeNull(); expect(f.reads).toHaveLength(0);
  await f.set('peer', { revision: 0, asset: photo() });
  expect(f.imageUrl).toBeNull(); expect(f.reads).toHaveLength(0);
});

function bytes() { return new Blob(['img'], { type: 'image/webp' }); }
function photo(suffix = '1'): UserAvatarAsset {
  const id = `ava_00000000-0000-0000-0000-00000000000${suffix}`;
  return { id, width: 64, height: 64, byteLength: 3, mimeType: 'image/webp', deliveryPath: `/auth/profile/avatar/assets/${id}` };
}
function deferred<T>() { let resolve!: (value: T) => void; return { promise: new Promise<T>(yes => { resolve = yes; }), resolve }; }
async function fixture(initial?: Promise<Blob>, authEnabled = true) {
  const listeners = new Set<() => void>();
  const auth = { user: { userId: 'operator' }, authorizationScopeKey: 'initial', activeTenant: null as { tenantId: string } | null,
    isLoading: false, isRestoring: false, isAuthenticated: true, sessionTransition: { phase: 'idle', revision: 0 },
    authorizationState: { status: 'ready' }, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; },
    subscribeAuthorization(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const dataBoundary = { revision: 0, subscribe(fn: () => void) { listeners.add(fn); return () => { listeners.delete(fn); }; } };
  const reads: { asset: UserAvatarAsset; signal: AbortSignal }[] = [];
  let pending = initial, directoryReads = 0;
  const client = { auth: authEnabled ? auth : null, _authorizationDataBoundary: dataBoundary, userAvatar: {
    async directory() { directoryReads++; throw new Error('A projected peer must not discover arbitrary profiles.'); },
    async deliver(asset: UserAvatarAsset, signal: AbortSignal) { reads.push({ asset, signal }); const result = pending; pending = undefined; return result ?? bytes(); },
  } } as unknown as Client;
  let imageUrl: string | null = null, update!: (value: { id: string; presentation: UserAvatarPresentation | null }) => void;
  function Capture() {
    const [value, set] = useState({ id: 'peer', presentation: { revision: 1, asset: photo() } as UserAvatarPresentation | null }); update = set;
    imageUrl = useUserAvatarPresentation(value.id, value.presentation); return null;
  }
  const root = createRoot(createHookContainer()); roots.add(root);
  await act(async () => root.render(createElement(ClientProvider, { client, children: createElement(Capture) })));
  return { root, auth, dataBoundary, reads, listeners, get imageUrl() { return imageUrl; }, get directoryReads() { return directoryReads; },
    hold(value: Promise<Blob>) { pending = value; }, notify() { for (const listener of listeners) listener(); },
    set: async (id: string, presentation: UserAvatarPresentation | null) => { await act(async () => update({ id, presentation })); },
  };
}
