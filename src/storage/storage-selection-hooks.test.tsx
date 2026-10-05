/** Synthetic hook state regression; no browser, server, file storage or live app. */
import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import { ClientProvider } from '../frontend/client/client-context';
import type { Client } from '../frontend/client/sdk';
import { createHookContainer, installMinimalHookDom } from '../frontend/client/test-fixtures/react-hook-dom';
import { useStorageFile, type UseStorageFileReturn } from './storage-file-hooks';
import { useStorageBrowser, type UseStorageBrowserReturn } from './storage-browser-hooks';
import type { FileInfo } from './types';

let restoreDom: () => void;
const roots = new Set<Root>();
beforeEach(() => { restoreDom = installMinimalHookDom(); });
afterEach(async () => {
  for (const root of roots) await act(async () => root.unmount());
  roots.clear(); restoreDom();
});

test('single-object display never pairs a replacement path with old metadata', async () => {
  const fixture = clientFixture();
  const history: Array<{ path: string; file: string | null }> = [];
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  function Capture({ path }: { path: string }) {
    const state = useStorageFile('drive-a', path);
    history.push({ path, file: state.file?.path ?? null }); return null;
  }
  const render = async (path: string) => act(async () => root.render(createElement(ClientProvider, {
    client: fixture.client, children: createElement(Capture, { path }),
  })));
  await render('old.txt');
  await act(async () => fixture.resolveInfo(file('drive-a', 'old.txt')));
  expect(history.at(-1)?.file).toBe('old.txt');
  await render('new.txt');
  expect(history.filter(value => value.path === 'new.txt').every(value => value.file === null)).toBe(true);
});

test('retained single-object action does not mutate the previous path after replacement', async () => {
  const fixture = clientFixture();
  const current: { state?: UseStorageFileReturn } = {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  function Capture({ path }: { path: string }) { current.state = useStorageFile('drive-a', path); return null; }
  const render = async (path: string) => act(async () => root.render(createElement(ClientProvider, {
    client: fixture.client, children: createElement(Capture, { path }),
  })));
  await render('old.txt'); const retained = current.state!.remove;
  await render('new.txt'); await act(async () => retained());
  expect(fixture.mutations).toEqual([]);
});

test('drive replacement clears browser path and selected object before reuse', async () => {
  const fixture = clientFixture();
  const current: { state?: UseStorageBrowserReturn } = {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  function Capture({ driveId }: { driveId: string }) { current.state = useStorageBrowser(driveId); return null; }
  const render = async (driveId: string) => act(async () => root.render(createElement(ClientProvider, {
    client: fixture.client, children: createElement(Capture, { driveId }),
  })));
  await render('drive-a');
  await act(async () => { current.state!.setPath('private'); current.state!.select(file('drive-a', 'old.txt')); });
  expect(current.state!.selected?.driveId).toBe('drive-a');
  const retained = current.state!.deleteSelected;
  await render('drive-b');
  expect(current.state!.path).toBe('');
  expect(current.state!.selected).toBeNull();
  await act(async () => retained());
  expect(fixture.mutations).toEqual([]);
});

test('unmounted file hooks abort pending reads and reject retained action admission', async () => {
  const fixture = clientFixture();
  const current: { state?: UseStorageFileReturn } = {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  function Capture() { current.state = useStorageFile('drive-a', 'old.txt'); return null; }
  await act(async () => root.render(createElement(ClientProvider, { client: fixture.client, children: createElement(Capture) })));
  const retained = current.state!;
  await act(async () => root.unmount()); roots.delete(root);
  expect(fixture.infoSignal()?.aborted).toBe(true);
  await act(async () => {
    fixture.resolveInfo(file('drive-a', 'old.txt'));
    retained.refresh(); await retained.remove(); await retained.setVisibility(true);
  });
  expect(fixture.mutations).toEqual([]);
  expect(retained.file).toBeNull();
});

test('unmounted browser cannot admit retained selected-object mutations', async () => {
  const fixture = clientFixture();
  const current: { state?: UseStorageBrowserReturn } = {};
  const { createRoot } = await import('react-dom/client');
  const root = createRoot(createHookContainer()); roots.add(root);
  function Capture() { current.state = useStorageBrowser('drive-a'); return null; }
  await act(async () => root.render(createElement(ClientProvider, { client: fixture.client, children: createElement(Capture) })));
  await act(async () => current.state!.select(file('drive-a', 'old.txt')));
  const retained = current.state!;
  await act(async () => root.unmount()); roots.delete(root);
  await act(async () => {
    await retained.deleteSelected(); await retained.moveSelected('new.txt'); await retained.copySelected('copy.txt');
  });
  expect(fixture.mutations).toEqual([]);
});

function clientFixture() {
  let infoResolve: ((value: FileInfo) => void) | undefined;
  let infoSignal: AbortSignal | undefined;
  const mutations: string[] = [];
  const client = {
    auth: null, url: 'http://synthetic.zero.invalid',
    fetch: (path: string, options?: { method?: string; signal?: AbortSignal }) => {
      if (options?.method && options.method !== 'GET') { mutations.push(path); return Promise.resolve({}); }
      if (path.includes('/info/')) {
        infoSignal = options?.signal;
        return new Promise<FileInfo>(resolve => { infoResolve = resolve; });
      }
      if (path.includes('/list')) return Promise.resolve({ items: [], total: 0, cursor: null });
      return Promise.resolve(null);
    },
  } as unknown as Client;
  return { client, mutations, infoSignal: () => infoSignal, resolveInfo(value: FileInfo) { infoResolve?.(value); } };
}

function file(driveId: string, path: string): FileInfo {
  return { id: `${driveId}:${path}`, driveId, path, name: path, type: 'file', sizeBytes: 1,
    mimeType: 'text/plain', checksum: null, isPublic: false, metadata: {}, createdBy: null, createdAt: 1, updatedAt: 1 };
}
