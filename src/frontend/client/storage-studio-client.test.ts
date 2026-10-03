import { describe, expect, test } from 'bun:test';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
} from '../../storage/storage-studio-contracts';
import type { FetchInit } from './sdk';
import {
  STORAGE_STUDIO_API_PREFIX,
  StorageStudioMutationError,
  createStorageStudioSdkSurface,
} from './storage-studio-client';

const capabilities: StorageStudioCapabilities = {
  enabled: true,
  scopeKind: 'tenant',
  ownerChoices: ['organization', 'personal'],
  canReadCatalog: true,
  canProvisionOrganization: true,
  canProvisionPersonal: true,
  canManage: true,
  canDelete: true,
  policy: {
    isolation: 'shared-cas',
    allowPublicDrives: false,
    allowPublicObjects: false,
    maxCapabilityTTL: 3600,
    maxOrganizationDrives: 10,
    maxPersonalDrivesPerUser: 2,
    defaultDriveSizeBytes: 1_000,
    defaultFileSizeBytes: 500,
    maxDriveSizeBytes: 10_000,
    maxFileSizeBytes: 1_000,
    maxObjectsPerDrive: 100,
    maxConcurrentUploadBytes: 2_000,
  },
};

const drive: StorageStudioDrive = {
  drive: {
    drive_id: 'drv_alpha',
    tenant_id: 'tenant_alpha',
    name: 'Artifacts',
    owner_id: null,
    max_size_bytes: 1_000,
    max_file_size_bytes: 500,
    allowed_mime_types: '*',
    public: 0,
    created_at: 10,
    access: {
      effectiveAccess: 'admin',
      canRead: true,
      canWrite: true,
      canAdmin: true,
      isOwner: false,
      isPlatformAdmin: false,
      isPublic: false,
    },
  },
  profile: {
    driveId: 'drv_alpha',
    key: 'artifacts',
    ownerKind: 'organization',
    ownerId: 'tenant_alpha',
    scopeKind: 'tenant',
    lifecycle: 'ready',
    revision: 2,
    isolation: 'shared-cas',
    generation: 1,
    createdAt: 10,
    updatedAt: 11,
    readyAt: 11,
    degradedAt: null,
    suspendedAt: null,
    deletingAt: null,
    deletedAt: null,
    restoringAt: null,
    failedAt: null,
    failureCode: null,
  },
  control: {
    canManage: true,
    canDelete: true,
    canSuspend: true,
    canRestore: false,
  },
};

describe('Storage Studio browser transport', () => {
  test('uses authenticated SDK route shapes for reads and cursor filters', async () => {
    const calls: Array<{ path: string; init?: FetchInit }> = [];
    const responses: unknown[] = [
      capabilities,
      { items: [drive], page: { limit: 25, count: 1, hasMore: true, nextCursor: 'next/one' } },
      drive,
      drive,
      {
        items: [{
          jobId: 'job_one',
          kind: 'provision',
          status: 'succeeded',
          generation: 1,
          attemptCount: 1,
          maxAttempts: 5,
          availableAt: 10,
          failureCode: null,
          createdAt: 10,
          updatedAt: 11,
          completedAt: 11,
        }],
        page: { limit: 10, count: 1, hasMore: false, nextCursor: null },
      },
    ];
    const studio = createStorageStudioSdkSurface(async (path, init) => {
      calls.push({ path, init });
      return responses.shift() as never;
    });
    studio.setScope('tenant:alpha');

    await studio.getCapabilities();
    await studio.listDrives({
      owner: 'organization',
      lifecycle: 'ready',
      search: 'patient files',
      cursor: 'next/one',
      limit: 25,
    });
    await studio.getDrive('drv_alpha');
    await studio.getDriveByKey('workflow-files', 'personal');
    await studio.listDriveJobs('drv_alpha', { cursor: 'job/cursor', limit: 10 });

    expect(calls.map((call) => [call.path, call.init?.method])).toEqual([
      [`${STORAGE_STUDIO_API_PREFIX}/capabilities`, 'GET'],
      [
        `${STORAGE_STUDIO_API_PREFIX}/drives?owner=organization&lifecycle=ready&search=patient+files&cursor=next%2Fone&limit=25`,
        'GET',
      ],
      [`${STORAGE_STUDIO_API_PREFIX}/drives/drv_alpha`, 'GET'],
      [`${STORAGE_STUDIO_API_PREFIX}/drives/by-key/workflow-files?owner=personal`, 'GET'],
      [`${STORAGE_STUDIO_API_PREFIX}/drives/drv_alpha/jobs?cursor=job%2Fcursor&limit=10`, 'GET'],
    ]);
  });

  test('includes one stable operation ID and validates mutation receipts', async () => {
    const calls: Array<{ path: string; init?: FetchInit }> = [];
    const studio = createStorageStudioSdkSurface(async (path, init) => {
      calls.push({ path, init });
      return { operationId: 'provision-one', replayed: false, value: drive } as never;
    });

    const result = await studio.provisionDrive({
      owner: 'organization',
      key: 'artifacts',
      name: 'Artifacts',
    }, { operationId: 'provision-one' });

    expect(result.value).toEqual(drive);
    expect(calls).toEqual([{
      path: `${STORAGE_STUDIO_API_PREFIX}/drives`,
      init: {
        method: 'POST',
        signal: undefined,
        body: {
          operationId: 'provision-one',
          owner: 'organization',
          key: 'artifacts',
          name: 'Artifacts',
        },
      },
    }]);
  });

  test('maps updates and lifecycle changes onto the canonical managed-drive routes', async () => {
    const calls: Array<{ path: string; init?: FetchInit }> = [];
    const receipts = [
      { operationId: 'update-two', replayed: false, value: drive },
      { operationId: 'lifecycle-two', replayed: true, value: drive },
    ];
    const studio = createStorageStudioSdkSurface(async (path, init) => {
      calls.push({ path, init });
      return receipts.shift() as never;
    });

    await studio.updateDrive('drv/alpha', {
      expectedRevision: 2,
      name: 'Renamed',
    }, { operationId: 'update-two' });
    await studio.changeDriveLifecycle('drv/alpha', {
      expectedRevision: 2,
      action: 'suspend',
    }, { operationId: 'lifecycle-two' });

    expect(calls).toEqual([
      {
        path: `${STORAGE_STUDIO_API_PREFIX}/drives/drv%2Falpha`,
        init: {
          method: 'PATCH',
          signal: undefined,
          body: {
            expectedRevision: 2,
            name: 'Renamed',
            operationId: 'update-two',
          },
        },
      },
      {
        path: `${STORAGE_STUDIO_API_PREFIX}/drives/drv%2Falpha/lifecycle`,
        init: {
          method: 'POST',
          signal: undefined,
          body: {
            expectedRevision: 2,
            action: 'suspend',
            operationId: 'lifecycle-two',
          },
        },
      },
    ]);
  });

  test('retains the operation ID when a write outcome is ambiguous', async () => {
    const studio = createStorageStudioSdkSurface(async () => {
      throw Object.assign(new Error('unavailable'), {
        status: 503,
        body: {
          code: 'STORAGE_OPERATION_OUTCOME_UNKNOWN',
          error: 'Storage mutation outcome is unknown.',
          outcome: 'unknown',
          requiresSameIdempotencyKey: true,
        },
      });
    });

    const error = await studio.updateDrive('drv_alpha', {
      expectedRevision: 2,
      name: 'Renamed',
    }, { operationId: 'update-one' }).catch((cause) => cause);

    expect(error).toBeInstanceOf(StorageStudioMutationError);
    expect(error).toMatchObject({
      operationId: 'update-one',
      status: 503,
      code: 'STORAGE_OPERATION_OUTCOME_UNKNOWN',
      outcome: 'unknown',
      requiresSameIdempotencyKey: true,
    });
  });

  test('discards a response completed after the authorization scope changes', async () => {
    let resolve!: (value: unknown) => void;
    const pending = new Promise<unknown>((next) => { resolve = next; });
    const studio = createStorageStudioSdkSurface(async () => pending as never);
    studio.setScope('tenant:alpha');
    const request = studio.getCapabilities();
    studio.setScope('tenant:beta');
    resolve(capabilities);

    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  test('retains the generated operation ID when scope changes after a mutation', async () => {
    let resolve!: (value: unknown) => void;
    let operationId = '';
    const pending = new Promise<unknown>((next) => { resolve = next; });
    const studio = createStorageStudioSdkSurface(async (_path, init) => {
      operationId = (init?.body as { operationId: string }).operationId;
      return pending as never;
    });
    studio.setScope('tenant:alpha');
    const request = studio.provisionDrive({
      owner: 'organization',
      key: 'artifacts',
      name: 'Artifacts',
    });
    studio.setScope('tenant:beta');
    resolve({ operationId, replayed: false, value: drive });

    const error = await request.catch((cause) => cause);
    expect(operationId).not.toBe('');
    expect(error).toBeInstanceOf(StorageStudioMutationError);
    expect(error).toMatchObject({
      name: 'StorageStudioMutationError',
      operationId,
      outcome: 'unknown',
      requiresSameIdempotencyKey: true,
    });
  });

  test('rejects malformed server projections rather than exposing partial authority', async () => {
    const studio = createStorageStudioSdkSurface(async () => ({
      ...capabilities,
      canDelete: 'yes',
    }) as never);

    await expect(studio.getCapabilities()).rejects.toThrow(
      'Invalid Storage Studio capabilities response.',
    );
  });
});
