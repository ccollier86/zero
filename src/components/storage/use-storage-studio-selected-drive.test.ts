import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import type { StorageStudioDrive } from '../../storage/storage-studio-contracts';
import { useSelectedStorageStudioDrive } from './use-storage-studio-selected-drive';

let root: Root | null = null;
let restoreDom: (() => void) | null = null;

beforeEach(() => { restoreDom = installMinimalDom(); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  restoreDom?.();
  restoreDom = null;
});

test('binds every off-page detail read to its scope and discards the previous scope', async () => {
  const alpha = deferred<StorageStudioDrive>();
  const beta = deferred<StorageStudioDrive>();
  const callScopes: string[] = [];
  let scope = '';
  const surface = {
    setScope(value: string) { scope = value; },
    clear() { scope = ''; },
    getDrive(id: string) {
      callScopes.push(scope);
      if (scope !== `tenant:${id}`) return Promise.reject(new Error('scope was not bound'));
      return id === 'alpha' ? alpha.promise : beta.promise;
    },
  } as unknown as StorageStudioSdkSurface;
  let current: StorageStudioDrive | null = null;
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createContainer());

  function Capture({ id }: { id: string }) {
    current = useSelectedStorageStudioDrive({
      catalogDrives: [],
      selectedDriveId: id,
      surface,
      boundary: boundary(`tenant:${id}`),
    });
    return null;
  }

  await act(async () => { root!.render(createElement(Capture, { id: 'alpha' })); });
  expect(callScopes).toEqual(['tenant:alpha']);
  await act(async () => { root!.render(createElement(Capture, { id: 'beta' })); });
  expect(callScopes).toEqual(['tenant:alpha', 'tenant:beta']);

  await act(async () => {
    alpha.resolve(drive('alpha'));
    beta.resolve(drive('beta'));
    await Promise.resolve();
  });
  expect((current as StorageStudioDrive | null)?.drive.drive_id).toBe('beta');
});

test('masks an off-page detail synchronously when the selected id changes in one scope', async () => {
  const alpha = deferred<StorageStudioDrive>();
  const beta = deferred<StorageStudioDrive>();
  const surface = {
    setScope() {},
    clear() {},
    getDrive(id: string) { return id === 'alpha' ? alpha.promise : beta.promise; },
  } as unknown as StorageStudioSdkSurface;
  const seen: Array<string | null> = [];
  let current: StorageStudioDrive | null = null;
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createContainer());

  function Capture({ id }: { id: string }) {
    current = useSelectedStorageStudioDrive({
      catalogDrives: [],
      selectedDriveId: id,
      surface,
      boundary: boundary('tenant:shared'),
    });
    seen.push(current?.drive.drive_id ?? null);
    return null;
  }

  await act(async () => { root!.render(createElement(Capture, { id: 'alpha' })); });
  await act(async () => {
    alpha.resolve(drive('alpha'));
    await Promise.resolve();
  });
  expect((current as StorageStudioDrive | null)?.drive.drive_id).toBe('alpha');

  seen.length = 0;
  await act(async () => { root!.render(createElement(Capture, { id: 'beta' })); });
  expect(seen[0]).toBeNull();
  expect(current).toBeNull();

  await act(async () => {
    beta.resolve(drive('beta'));
    await Promise.resolve();
  });
  expect((current as StorageStudioDrive | null)?.drive.drive_id).toBe('beta');
});

function boundary(key: string): AuthorizationScopeBoundary {
  return {
    key,
    scopeKey: key,
    dataRevision: 1,
    stable: true,
    ready: true,
    phase: 'idle',
  };
}

function drive(id: string): StorageStudioDrive {
  return { drive: { drive_id: id } } as StorageStudioDrive;
}

function createContainer(): Element {
  return {
    nodeType: 1,
    nodeName: 'DIV',
    tagName: 'DIV',
    namespaceURI: 'http://www.w3.org/1999/xhtml',
    ownerDocument: globalThis.document,
    addEventListener() {},
    removeEventListener() {},
    appendChild() {},
    removeChild() {},
    textContent: '',
    firstChild: null,
  } as unknown as Element;
}

function installMinimalDom(): () => void {
  const keys = ['window', 'document', 'IS_REACT_ACT_ENVIRONMENT'] as const;
  const previous = new Map<string, PropertyDescriptor | undefined>(
    keys.map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]),
  );
  class HTMLIFrameElement {}
  const window = { HTMLIFrameElement, document: null as unknown };
  const document = {
    nodeType: 9,
    defaultView: window,
    activeElement: null,
    body: null,
    addEventListener() {},
    removeEventListener() {},
  };
  window.document = document;
  Object.defineProperties(globalThis, {
    window: { configurable: true, writable: true, value: window },
    document: { configurable: true, writable: true, value: document },
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, writable: true, value: true },
  });
  return () => {
    for (const key of keys) {
      const descriptor = previous.get(key);
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  };
}

function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void } {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}
