import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act, createElement } from 'react';
import type { Root } from 'react-dom/client';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDrivePage,
  StorageStudioJobPage,
} from '../../storage/storage-studio-contracts';
import { useStorageStudioCatalog } from './use-storage-studio-catalog';
import { useStorageStudioJobs } from './use-storage-studio-jobs';
import type { UseStorageStudioCatalogResult } from './use-storage-studio-catalog';

let root: Root | null = null;
let restoreDom: (() => void) | null = null;

beforeEach(() => { restoreDom = installMinimalDom(); });
afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  root = null;
  restoreDom?.();
  restoreDom = null;
});

test('job history is synchronously hidden when the selected drive changes', async () => {
  const alpha = deferred<StorageStudioJobPage>();
  const beta = deferred<StorageStudioJobPage>();
  const surface = {
    listDriveJobs(driveId: string) { return driveId === 'alpha' ? alpha.promise : beta.promise; },
  } as unknown as StorageStudioSdkSurface;
  let ids: readonly string[] = [];
  const seen: Array<readonly string[]> = [];
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createContainer());

  function Capture({ driveId }: { driveId: string }) {
    const state = useStorageStudioJobs({
      surface,
      boundary: boundary('tenant:shared'),
      driveId,
      enabled: true,
    });
    ids = state.jobs.map((job) => job.id);
    seen.push(ids);
    return null;
  }

  await act(async () => { root!.render(createElement(Capture, { driveId: 'alpha' })); });
  await act(async () => {
    alpha.resolve(jobPage('alpha'));
    await Promise.resolve();
  });
  expect(ids).toEqual(['job-alpha']);

  seen.length = 0;
  await act(async () => { root!.render(createElement(Capture, { driveId: 'beta' })); });
  expect(seen[0]).toEqual([]);
  expect(ids).toEqual([]);

  await act(async () => {
    beta.resolve(jobPage('beta'));
    await Promise.resolve();
  });
  expect(ids).toEqual(['job-beta']);
});

test('catalog page is synchronously hidden when its filter identity changes', async () => {
  const alpha = deferred<StorageStudioDrivePage>();
  const beta = deferred<StorageStudioDrivePage>();
  const surface = {
    setScope() {},
    getCapabilities: async () => capabilities(),
    listDrives(request: { search?: string }) {
      return request.search === 'beta' ? beta.promise : alpha.promise;
    },
  } as unknown as StorageStudioSdkSurface;
  let ids: readonly string[] = [];
  const seen: Array<readonly string[]> = [];
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createContainer());

  function Capture({ search }: { search: string }) {
    const state = useStorageStudioCatalog({
      surface,
      boundary: boundary('tenant:shared'),
      enabled: true,
      authenticated: true,
      request: { search },
      pageSize: 20,
    });
    ids = state.drives.map((item) => item.drive.drive_id);
    seen.push(ids);
    return null;
  }

  await act(async () => { root!.render(createElement(Capture, { search: 'alpha' })); });
  await act(async () => {
    alpha.resolve(drivePage('alpha'));
    await Promise.resolve();
  });
  expect(ids).toEqual(['alpha']);

  seen.length = 0;
  await act(async () => { root!.render(createElement(Capture, { search: 'beta' })); });
  expect(seen[0]).toEqual([]);
  expect(ids).toEqual([]);

  await act(async () => {
    beta.resolve(drivePage('beta'));
    await Promise.resolve();
  });
  expect(ids).toEqual(['beta']);
});

test('catalog drops opaque cursor history when the authorization scope changes', async () => {
  let scope = '';
  const calls: Array<{ scope: string; cursor: string | undefined }> = [];
  const surface = {
    setScope(value: string) { scope = value; },
    getCapabilities: async () => capabilities(),
    async listDrives(request: { cursor?: string }) {
      calls.push({ scope, cursor: request.cursor });
      if (scope === 'tenant:alpha' && !request.cursor) {
        return drivePage('alpha-one', 'alpha-next');
      }
      if (scope === 'tenant:alpha') return drivePage('alpha-two');
      return drivePage('beta-one');
    },
  } as unknown as StorageStudioSdkSurface;
  let state: UseStorageStudioCatalogResult | null = null;
  const seenPages: number[] = [];
  const { createRoot } = await import('react-dom/client');
  root = createRoot(createContainer());

  function Capture({ scopeKey }: { scopeKey: string }) {
    state = useStorageStudioCatalog({
      surface,
      boundary: boundary(scopeKey),
      enabled: true,
      authenticated: true,
      request: {},
      pageSize: 20,
    });
    seenPages.push(state.pagination.page);
    return null;
  }

  await act(async () => { root!.render(createElement(Capture, { scopeKey: 'tenant:alpha' })); });
  expect((state as UseStorageStudioCatalogResult | null)?.drives[0]?.drive.drive_id).toBe('alpha-one');
  await act(async () => { (state as UseStorageStudioCatalogResult | null)?.nextPage(); });
  expect((state as UseStorageStudioCatalogResult | null)?.pagination.page).toBe(2);
  expect((state as UseStorageStudioCatalogResult | null)?.drives[0]?.drive.drive_id).toBe('alpha-two');

  seenPages.length = 0;
  await act(async () => { root!.render(createElement(Capture, { scopeKey: 'tenant:beta' })); });
  expect(seenPages[0]).toBe(1);
  expect((state as UseStorageStudioCatalogResult | null)?.pagination.page).toBe(1);
  expect((state as UseStorageStudioCatalogResult | null)?.drives[0]?.drive.drive_id).toBe('beta-one');
  expect(calls.filter((call) => call.scope === 'tenant:beta'))
    .toEqual([{ scope: 'tenant:beta', cursor: undefined }]);
});

function boundary(key: string): AuthorizationScopeBoundary {
  return { key, scopeKey: key, dataRevision: 1, stable: true, ready: true, phase: 'idle' };
}

function capabilities(): StorageStudioCapabilities {
  return {
    enabled: true,
    scopeKind: 'tenant',
    ownerChoices: ['organization'],
    canReadCatalog: true,
    canProvisionOrganization: true,
    canProvisionPersonal: false,
    canManage: true,
    canDelete: true,
    policy: {
      isolation: 'shared-cas',
      allowPublicDrives: false,
      allowPublicObjects: false,
      maxCapabilityTTL: 60,
      maxOrganizationDrives: 10,
      maxPersonalDrivesPerUser: 0,
      defaultDriveSizeBytes: 1,
      defaultFileSizeBytes: 1,
      maxDriveSizeBytes: 10,
      maxFileSizeBytes: 10,
      maxObjectsPerDrive: 10,
      maxConcurrentUploadBytes: 10,
    },
  };
}

function drivePage(id: string, nextCursor: string | null = null): StorageStudioDrivePage {
  return {
    items: [{ drive: { drive_id: id } } as StorageStudioDrive],
    page: { limit: 20, count: 1, hasMore: nextCursor !== null, nextCursor },
  };
}

function jobPage(id: string): StorageStudioJobPage {
  return {
    items: [{
      jobId: `job-${id}`,
      kind: 'provision',
      status: 'succeeded',
      generation: 1,
      attemptCount: 1,
      maxAttempts: 3,
      availableAt: 1,
      failureCode: null,
      createdAt: 1,
      updatedAt: 1,
      completedAt: 1,
    }],
    page: { limit: 100, count: 1, hasMore: false, nextCursor: null },
  };
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
