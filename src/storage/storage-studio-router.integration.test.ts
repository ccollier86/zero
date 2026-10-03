/**
 * Exercises Storage Studio through the final Elysia mount. These tests keep
 * transport/auth composition separate from the service-level lifecycle suite.
 */

import { afterEach, describe, expect, test } from 'bun:test';
import { Elysia, type AnyElysia } from 'elysia';

import { resolveAuthBehaviorConfig } from '../auth/auth-config';
import type {
  AuthRequestAuthorityReference,
  AuthRequestCredentialResolver,
} from '../auth/auth-api-key-types';
import type { AuthorizationRoleAssignmentResolver } from '../auth/authorization-access';
import { createAuthorizationKernel } from '../auth/authorization-kernel';
import { createAuthMiddleware } from '../auth/auth.middleware';
import type { AuthorizationRoleSet } from '../auth/authorization-role-types';
import type { TokenService } from '../auth/token-service';
import type { AuthContext } from '../auth/types';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import {
  STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT,
  STORAGE_STUDIO_PERMISSION_REGISTRY,
  STORAGE_STUDIO_VIEWER_ROLE_FRAGMENT,
} from './storage-studio-access';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDrivePage,
  StorageStudioJobPage,
  StorageStudioMutationReceipt,
} from './storage-studio-contracts';
import { resolveStorageStudioConfig } from './storage-config';
import { createStoragePlugin } from './storage.plugin';
import type { StorageService } from './storage-service';
import type { StorageStudioLifecycleProvider } from './storage-studio-recovery-coordinator';
import type { DriveRecord, StorageAdapter } from './types';

const TENANT_A = 'tenant_storage_studio_alpha';
const TENANT_B = 'tenant_storage_studio_beta';
const ADMIN_ROLE = 'storage-administrator';
const VIEWER_ROLE = 'storage-viewer';

interface Harness {
  readonly app: AnyElysia;
  readonly baseUrl: string;
  readonly db: ReactiveDB;
  readonly storage: StorageService;
  readonly credentials: TestCredentialResolver;
}

interface HttpResult<T> {
  readonly status: number;
  readonly headers: Headers;
  readonly body: T;
}

const active: Harness[] = [];

afterEach(async () => {
  for (const harness of active.splice(0).reverse()) {
    await harness.app.stop(true);
    harness.db.dispose();
  }
});

describe('Storage Studio mounted request surface', () => {
  test('keeps legacy storage compatible while Studio is disabled', async () => {
    const harness = startHarness(false);

    const created = await json<DriveRecord>(harness, 'POST', '/storage/drives', {
      name: 'Legacy tenant drive',
    }, 'session-a');
    expect(created.status).toBe(200);
    expect(created.body).toMatchObject({
      tenant_id: TENANT_A,
      name: 'Legacy tenant drive',
      owner_id: 'user-a',
    });

    const studio = await json<StorageFailure>(
      harness,
      'GET',
      '/storage/studio/capabilities',
      undefined,
      'session-a',
    );
    expect(studio).toMatchObject({
      status: 503,
      body: {
        code: 'STORAGE_STUDIO_DISABLED',
        error: 'Storage Studio is disabled.',
        retryable: false,
        outcome: 'not-started',
      },
    });
    expect(studio.headers.get('cache-control')).toBe('private, no-store, max-age=0');
  });

  test('mounts the authenticated catalog and admits both sessions and API keys', async () => {
    const harness = startHarness(true);

    const anonymous = await json<Record<string, unknown>>(
      harness,
      'GET',
      '/storage/studio/capabilities',
    );
    expect(anonymous.status).toBe(401);
    expect(anonymous.body).toMatchObject({ code: 'UNAUTHORIZED' });

    for (const credential of ['session-a', 'api-key-a']) {
      const capabilities = await json<StorageStudioCapabilities>(
        harness,
        'GET',
        '/storage/studio/capabilities',
        undefined,
        credential,
      );
      expect(capabilities.status).toBe(200);
      expect(capabilities.headers.get('cache-control')).toBe('private, no-store, max-age=0');
      expect(capabilities.body).toMatchObject({
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
        },
      });
    }

    const legacyBypass = await json<StorageFailure>(
      harness,
      'POST',
      '/storage/drives',
      { name: 'Unmanaged bypass' },
      'session-a',
    );
    expect(legacyBypass).toMatchObject({
      status: 403,
      body: {
        code: 'STORAGE_POLICY_VIOLATION',
        error: 'Storage policy does not permit this operation.',
        retryable: false,
        outcome: 'not-started',
      },
    });
  });

  test('revalidates session and API-key authority inside HTTP mutation commits', async () => {
    const harness = startHarness(true);
    const provisioned = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'provision-http-commit-fences',
        owner: 'organization',
        key: 'http-commit-fences',
        name: 'HTTP commit fences',
        creatorAccess: 'admin',
      },
      'session-a',
    );
    const driveId = provisioned.body.value.profile.driveId;
    harness.storage.grantPermission(driveId, {
      grantType: 'user',
      grantValue: 'user-a',
      permission: 'admin',
    });
    await harness.storage.upload(
      driveId,
      '/source.bin',
      new Uint8Array([1]),
      'source.bin',
      'user-a',
    );

    for (const credential of ['session-a', 'api-key-a']) {
      let entered!: () => void;
      let release!: () => void;
      const enteredFence = new Promise<void>((resolve) => { entered = resolve; });
      const heldFence = new Promise<void>((resolve) => { release = resolve; });
      const lockHolder = harness.storage.upload(
        driveId,
        '/source.bin',
        new Uint8Array([2]),
        'source.bin',
        'user-a',
        { overwrite: true },
        undefined,
        async () => {
          entered();
          await heldFence;
        },
      );
      await withinOneSecond(enteredFence, 'storage lock holder did not enter commit fence');

      const captured = harness.credentials.waitForNextCapture();
      const mutation = json<StorageFailure>(
        harness,
        'POST',
        `/storage/drives/${driveId}/move`,
        { from: '/source.bin', to: `/${credential}-target.bin` },
        credential,
      );
      const admission = await withinOneSecond(Promise.race([
        captured.then(() => ({ kind: 'captured' as const })),
        mutation.then((response) => ({ kind: 'response' as const, response })),
      ]), 'HTTP mutation did not reach its route');
      if (admission.kind === 'response') {
        throw new Error(
          `HTTP mutation settled before authority capture: ${JSON.stringify(admission.response)}`,
        );
      }
      harness.credentials.revoke(credential);
      release();
      await withinOneSecond(lockHolder, 'storage lock holder did not release');

      const rejected = await withinOneSecond(mutation, 'HTTP mutation did not settle');
      expect(rejected.status).toBe(403);
      expect(rejected.body.code).toBe('STORAGE_AUTHORITY_CHANGED');
      expect(harness.storage.getFileInfo(driveId, '/source.bin')).not.toBeNull();
      expect(harness.storage.getFileInfo(
        driveId,
        `/${credential}-target.bin`,
      )).toBeNull();
      harness.credentials.restore(credential);
    }
  });

  test('seals legacy managed control routes and invalidates pre-suspension capabilities', async () => {
    const harness = startHarness(true);
    const provisioned = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'provision-ingress-guards',
        owner: 'organization',
        key: 'ingress-guards',
        name: 'Ingress guards',
        creatorAccess: 'admin',
      },
      'session-a',
    );
    expect(provisioned.status).toBe(200);
    const driveId = provisioned.body.value.profile.driveId;

    for (const [method, path, body] of [
      ['PATCH', `/storage/drives/${driveId}`, { name: 'Bypassed update' }],
      ['PATCH', `/storage/drives/${driveId}/visibility`, { public: true }],
      ['DELETE', `/storage/drives/${driveId}`, undefined],
    ] as const) {
      const rejected = await json<StorageFailure>(
        harness,
        method,
        path,
        body,
        'session-a',
      );
      expect(rejected.status).toBe(403);
      expect(rejected.body.code).toBe('STORAGE_POLICY_VIOLATION');
    }

    const publicFolder = await json<StorageFailure>(
      harness,
      'POST',
      `/storage/drives/${driveId}/folders`,
      { path: '/public-folder', public: true },
      'session-a',
    );
    expect(publicFolder.status).toBe(403);
    expect(publicFolder.body.code).toBe('STORAGE_POLICY_VIOLATION');

    const issued = await json<{ token: string; expiresIn: number }>(
      harness,
      'POST',
      `/storage/drives/${driveId}/presign`,
      { path: '/future.txt', method: 'download', expiresIn: 60 },
      'session-a',
    );
    expect(issued.status).toBe(200);

    const suspended = await lifecycle(
      harness,
      driveId,
      'session-a',
      'suspend-ingress-guards',
      2,
      'suspend',
    );
    expect(suspended.body.value.profile.generation).toBe(2);
    const whileSuspended = await json<StorageFailure>(
      harness,
      'GET',
      `/storage/presigned/${issued.body.token}`,
    );
    expect(whileSuspended.status).toBe(403);
    expect(whileSuspended.body.code).toBe('STORAGE_POLICY_VIOLATION');

    await lifecycle(
      harness,
      driveId,
      'session-a',
      'resume-ingress-guards',
      3,
      'resume',
    );
    const stale = await json<StorageFailure>(
      harness,
      'GET',
      `/storage/presigned/${issued.body.token}`,
    );
    expect(stale.status).toBe(403);
    expect(stale.body.code).toBe('STORAGE_CAPABILITY_INVALID');
  });

  test('does not return detached bearer capabilities after request authority changes', async () => {
    const harness = startHarness(true);
    const provisioned = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'provision-capability-issuance-fence',
        owner: 'organization',
        key: 'capability-issuance-fence',
        name: 'Capability issuance fence',
        creatorAccess: 'admin',
      },
      'session-a',
    );
    const driveId = provisioned.body.value.profile.driveId;

    for (const credential of ['session-a', 'api-key-a']) {
      harness.credentials.revokeOnNextAuthorityCapture(credential);
      const presigned = await json<StorageFailure>(
        harness,
        'POST',
        `/storage/drives/${driveId}/presign`,
        { path: `/${credential}.bin`, method: 'upload' },
        credential,
      );
      expect(presigned).toMatchObject({
        status: 403,
        body: { code: 'STORAGE_AUTHORITY_CHANGED', outcome: 'not-committed' },
      });
      harness.credentials.restore(credential);

      harness.credentials.revokeOnNextAuthorityCapture(credential);
      const grant = await json<StorageFailure>(
        harness,
        'POST',
        `/storage/drives/${driveId}/upload-grants`,
        { path: `/${credential}-grant.bin` },
        credential,
      );
      expect(grant).toMatchObject({
        status: 403,
        body: { code: 'STORAGE_AUTHORITY_CHANGED', outcome: 'not-committed' },
      });
      harness.credentials.restore(credential);
    }
  });

  test('generation-fences bearer uploads across suspend and suspend-resume races', async () => {
    const adapter = new BlockingStorageAdapter();
    const harness = startHarness(true, adapter);
    const provisioned = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'provision-capability-races',
        owner: 'organization',
        key: 'capability-races',
        name: 'Capability races',
        creatorAccess: 'admin',
      },
      'session-a',
    );
    const driveId = provisioned.body.value.profile.driveId;

    const suspendedToken = await issueUploadCapability(harness, driveId, '/suspended.bin');
    const firstBarrier = adapter.blockNextWrite();
    const suspendedUpload = fetch(`${harness.baseUrl}/storage/presigned/${suspendedToken}`, {
      method: 'PUT',
      body: new Uint8Array([1]),
    });
    await firstBarrier.started;
    const suspended = await lifecycle(
      harness, driveId, 'session-a', 'suspend-capability-race', 2, 'suspend',
    );
    expect(suspended.status).toBe(200);
    firstBarrier.release();
    const suspendedResponse = await suspendedUpload;
    expect(suspendedResponse.status).toBe(403);
    expect(await suspendedResponse.json()).toMatchObject({
      code: 'STORAGE_POLICY_VIOLATION',
    });

    const resumed = await lifecycle(
      harness, driveId, 'session-a', 'resume-capability-race', 3, 'resume',
    );
    expect(resumed.status).toBe(200);
    const staleToken = await issueUploadCapability(harness, driveId, '/stale.bin');
    const secondBarrier = adapter.blockNextWrite();
    const staleUpload = fetch(`${harness.baseUrl}/storage/presigned/${staleToken}`, {
      method: 'PUT',
      body: new Uint8Array([2]),
    });
    await secondBarrier.started;
    expect((await lifecycle(
      harness, driveId, 'session-a', 'suspend-generation-race', 4, 'suspend',
    )).status).toBe(200);
    expect((await lifecycle(
      harness, driveId, 'session-a', 'resume-generation-race', 5, 'resume',
    )).status).toBe(200);
    secondBarrier.release();
    const staleResponse = await staleUpload;
    expect(staleResponse.status).toBe(403);
    expect(await staleResponse.json()).toMatchObject({
      code: 'STORAGE_AUTHORITY_CHANGED',
      outcome: 'not-committed',
    });
  });

  test('completes system-owned HTTP restore but withholds response after revocation', async () => {
    let entered!: () => void;
    let release!: () => void;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const providerRelease = new Promise<void>((resolve) => { release = resolve; });
    const harness = startHarness(true, testAdapter(), {
      retryProvisioning: () => undefined,
      async restoreDrive() {
        entered();
        await providerRelease;
      },
    });
    const provisioned = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'provision-http-restore-race',
        owner: 'organization',
        key: 'http-restore-race',
        name: 'HTTP restore race',
        creatorAccess: 'admin',
      },
      'session-a',
    );
    const driveId = provisioned.body.value.profile.driveId;
    const deleted = await lifecycle(
      harness,
      driveId,
      'session-a',
      'delete-http-restore-race',
      provisioned.body.value.profile.revision,
      'delete',
    );
    const restoring = lifecycle(
      harness,
      driveId,
      'session-a',
      'restore-http-authority-race',
      deleted.body.value.profile.revision,
      'restore',
    );
    await providerEntered;
    harness.credentials.revoke('session-a');
    release();

    const rejected = await restoring;
    expect(rejected.status).toBe(403);
    expect(rejected.body).toMatchObject({
      code: 'STORAGE_AUTHORITY_CHANGED',
      outcome: 'committed',
    });
    expect(harness.db.prepare(`
      SELECT lifecycle, failure_code FROM _storage_drive_profiles
      WHERE drive_id = ?
    `).get(driveId)).toEqual({
      lifecycle: 'ready',
      failure_code: null,
    });
    expect(harness.db.prepare(`
      SELECT status, error_code FROM _storage_studio_operations
      WHERE idempotency_key = ?
    `).get('restore-http-authority-race')).toEqual({
      status: 'succeeded',
      error_code: null,
    });
  });

  test('provisions, pages, resolves, updates, transitions, and exposes job history', async () => {
    const harness = startHarness(true);
    const provisionBody = {
      operationId: 'provision-artifacts',
      owner: 'organization',
      key: 'artifacts',
      name: 'Build artifacts',
      maxSize: 1_000_000,
      maxFileSize: 100_000,
      allowedMimeTypes: ['application/json'],
      creatorAccess: 'admin',
    };

    const provisioned = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      provisionBody,
      'api-key-a',
    );
    expect(provisioned.status).toBe(200);
    expect(provisioned.body).toMatchObject({
      operationId: 'provision-artifacts',
      replayed: false,
      value: {
        drive: {
          tenant_id: TENANT_A,
          name: 'Build artifacts',
          max_size_bytes: 1_000_000,
          max_file_size_bytes: 100_000,
        },
        profile: {
          key: 'artifacts',
          ownerKind: 'organization',
          ownerId: TENANT_A,
          scopeKind: 'tenant',
          lifecycle: 'ready',
          revision: 2,
          isolation: 'shared-cas',
          generation: 1,
        },
        control: {
          canManage: true,
          canDelete: true,
          canSuspend: true,
          canRestore: false,
        },
      },
    });
    const driveId = provisioned.body.value.profile.driveId;

    const replay = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      provisionBody,
      'session-a',
    );
    expect(replay).toMatchObject({
      status: 200,
      body: { operationId: 'provision-artifacts', replayed: true },
    });
    expect(replay.body.value.profile.driveId).toBe(driveId);

    const listed = await json<StorageStudioDrivePage>(
      harness,
      'GET',
      '/storage/studio/drives?owner=organization&lifecycle=ready&search=art&limit=1',
      undefined,
      'session-a',
    );
    expect(listed.status).toBe(200);
    expect(listed.body.items.map((item) => item.profile.driveId)).toEqual([driveId]);
    expect(listed.body.page).toEqual({
      limit: 1,
      count: 1,
      hasMore: false,
      nextCursor: null,
    });

    const byId = await json<StorageStudioDrive>(
      harness,
      'GET',
      `/storage/studio/drives/${driveId}`,
      undefined,
      'session-a',
    );
    expect(byId.status).toBe(200);
    expect(byId.body.profile.key).toBe('artifacts');

    const byKey = await json<StorageStudioDrive>(
      harness,
      'GET',
      '/storage/studio/drives/by-key/artifacts?owner=organization',
      undefined,
      'session-a',
    );
    expect(byKey.status).toBe(200);
    expect(byKey.body.profile.driveId).toBe(driveId);

    const updated = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'PATCH',
      `/storage/studio/drives/${driveId}`,
      {
        operationId: 'update-artifacts',
        expectedRevision: 2,
        name: 'Deployment artifacts',
      },
      'session-a',
    );
    expect(updated.status).toBe(200);
    expect(updated.body.value).toMatchObject({
      drive: { name: 'Deployment artifacts' },
      profile: { revision: 3, lifecycle: 'ready' },
    });

    const suspended = await lifecycle(
      harness,
      driveId,
      'session-a',
      'suspend-artifacts',
      3,
      'suspend',
    );
    expect(suspended.status).toBe(200);
    expect(suspended.body.value.profile).toMatchObject({
      lifecycle: 'suspended',
      revision: 4,
      generation: 2,
    });

    const resumed = await lifecycle(
      harness,
      driveId,
      'api-key-a',
      'resume-artifacts',
      4,
      'resume',
    );
    expect(resumed.status).toBe(200);
    expect(resumed.body.value.profile).toMatchObject({
      lifecycle: 'ready',
      revision: 5,
      generation: 2,
    });

    const deleted = await lifecycle(
      harness,
      driveId,
      'session-a',
      'delete-artifacts',
      5,
      'delete',
    );
    expect(deleted.status).toBe(200);
    expect(deleted.body.value.profile).toMatchObject({
      lifecycle: 'deleted',
      revision: 7,
      generation: 3,
    });

    const jobs = await json<StorageStudioJobPage>(
      harness,
      'GET',
      `/storage/studio/drives/${driveId}/jobs?limit=1`,
      undefined,
      'api-key-a',
    );
    expect(jobs.status).toBe(200);
    expect(jobs.body.items).toHaveLength(1);
    expect(jobs.body.items[0]).toMatchObject({
      kind: 'cleanup',
      status: 'succeeded',
      generation: 3,
      attemptCount: 1,
      failureCode: null,
    });
    expect(jobs.body.page).toEqual({
      limit: 1,
      count: 1,
      hasMore: false,
      nextCursor: null,
    });
  });

  test('enforces live RBAC and conceals drives across tenant boundaries', async () => {
    const harness = startHarness(true);
    const denied = await json<StorageFailure>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'viewer-provision',
        owner: 'organization',
        key: 'viewer-files',
        name: 'Viewer files',
      },
      'viewer-a',
    );
    expect(denied).toMatchObject({
      status: 403,
      body: {
        code: 'STORAGE_AUTHORITY_REQUIRED',
        error: 'Storage access is forbidden.',
        retryable: false,
        outcome: 'not-started',
      },
    });

    const created = await json<StorageStudioMutationReceipt<StorageStudioDrive>>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'tenant-a-private-drive',
        owner: 'organization',
        key: 'tenant-private',
        name: 'Tenant A private',
      },
      'session-a',
    );
    expect(created.status).toBe(200);
    const driveId = created.body.value.profile.driveId;

    const tenantBList = await json<StorageStudioDrivePage>(
      harness,
      'GET',
      '/storage/studio/drives',
      undefined,
      'session-b',
    );
    expect(tenantBList.status).toBe(200);
    expect(tenantBList.body.items).toEqual([]);

    const crossTenantRead = await json<StorageFailure>(
      harness,
      'GET',
      `/storage/studio/drives/${driveId}`,
      undefined,
      'session-b',
    );
    expect(crossTenantRead).toMatchObject({
      status: 404,
      body: {
        code: 'STORAGE_DRIVE_NOT_FOUND',
        error: 'Storage drive was not found.',
        retryable: false,
        outcome: 'not-started',
      },
    });

    const crossTenantJobs = await json<StorageFailure>(
      harness,
      'GET',
      `/storage/studio/drives/${driveId}/jobs`,
      undefined,
      'session-b',
    );
    expect(crossTenantJobs).toMatchObject({
      status: 404,
      body: {
        code: 'STORAGE_DRIVE_NOT_FOUND',
        error: 'Storage drive was not found.',
        retryable: false,
        outcome: 'not-started',
      },
    });

    const staleUpdate = await json<StorageFailure>(
      harness,
      'PATCH',
      `/storage/studio/drives/${driveId}`,
      {
        operationId: 'stale-update',
        expectedRevision: 1,
        name: 'Must not apply',
      },
      'session-a',
    );
    expect(staleUpdate).toMatchObject({
      status: 409,
      body: {
        code: 'STORAGE_REVISION_CONFLICT',
        error: 'Storage revision changed.',
        retryable: false,
        outcome: 'not-committed',
      },
    });

    const unchanged = await json<StorageStudioDrive>(
      harness,
      'GET',
      `/storage/studio/drives/${driveId}`,
      undefined,
      'session-a',
    );
    expect(unchanged.body.drive.name).toBe('Tenant A private');
  });

  test('does not misreport a non-unique persistence constraint as a drive-key conflict', async () => {
    const harness = startHarness(true);
    // Deliberately violate the server-owned identity/profile invariant so the
    // operation receipt's actor FK fails after the drive reservation begins.
    harness.db.exec("DELETE FROM users WHERE user_id = 'user-a'");

    const failed = await json<StorageFailure>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'missing-actor-reference',
        owner: 'organization',
        key: 'must-rollback',
        name: 'Must roll back',
      },
      'session-a',
    );

    expect(failed.status).toBe(503);
    expect(failed.body).toMatchObject({
      code: 'STORAGE_INTERNAL',
      error: 'Storage mutation outcome is unknown.',
      retryable: false,
      outcome: 'unknown',
      requiresSameIdempotencyKey: true,
    });
    expect(failed.body.code).not.toBe('STORAGE_DRIVE_KEY_CONFLICT');
    expect(harness.db.prepare(
      "SELECT COUNT(*) AS count FROM storage_drives WHERE name = 'Must roll back'",
    ).get()).toEqual({ count: 0 });
  });

  test('maps schema and body parse failures onto the safe Storage error contract', async () => {
    const harness = startHarness(true);
    const invalid = await json<StorageFailure>(
      harness,
      'POST',
      '/storage/studio/drives',
      {
        operationId: 'invalid-key-request',
        owner: 'organization',
        key: 'NOT A VALID KEY',
        name: 'Rejected',
      },
      'session-a',
    );
    expect(invalid).toMatchObject({
      status: 400,
      body: {
        code: 'STORAGE_INPUT_INVALID',
        error: 'Storage input is invalid.',
        retryable: false,
        outcome: 'not-started',
      },
    });

    const parsed = await fetch(`${harness.baseUrl}/storage/studio/drives`, {
      method: 'POST',
      headers: {
        authorization: 'Bearer session-a',
        'content-type': 'application/json',
      },
      body: '{',
    });
    expect(parsed.status).toBe(400);
    expect(await parsed.json()).toMatchObject({
      code: 'STORAGE_INPUT_INVALID',
      error: 'Storage input is invalid.',
      retryable: false,
      outcome: 'not-started',
    });
  });
});

interface StorageFailure {
  readonly error: string;
  readonly code: string;
  readonly retryable: boolean;
  readonly outcome?: string;
  readonly requiresSameIdempotencyKey?: true;
}

function startHarness(
  studioEnabled: boolean,
  adapter: StorageAdapter = testAdapter(),
  lifecycleProvider?: StorageStudioLifecycleProvider,
): Harness {
  const db = createReactiveDB({ mode: 'memory' });
  installIdentityReferences(db);
  const contexts = requestContexts();
  const credentials = new TestCredentialResolver(contexts);
  const tokenService = {
    async resolveAuthContext(token: string) {
      return contexts.get(token) ?? null;
    },
  } as TokenService;
  const kernel = createAuthorizationKernel(resolveAuthBehaviorConfig({
    tenancy: 'multi',
    authorization: {
      mode: 'advanced',
      permissions: STORAGE_STUDIO_PERMISSION_REGISTRY,
      roles: {
        [ADMIN_ROLE]: STORAGE_STUDIO_ADMIN_ROLE_FRAGMENT,
        [VIEWER_ROLE]: STORAGE_STUDIO_VIEWER_ROLE_FRAGMENT,
      },
    },
  }));
  const roleAssignments = createRoleAssignments();
  const authorization = {
    getRequestCredentialResolver: () => credentials,
    getAuthorizationKernel: () => kernel,
    getPropertyStore: () => null,
    getRoleAssignments: () => roleAssignments,
  };
  let storage!: StorageService;
  const app = new Elysia()
    .use(createAuthMiddleware(() => tokenService, authorization))
    .onBeforeHandle({ as: 'global' }, ({ request, access }) => {
      const pathname = new URL(request.url).pathname;
      if (/^\/storage\/drives\/[^/]+\/(?:move|copy)$/u.test(pathname)
        || /^\/storage\/drives\/[^/]+\/files\//u.test(pathname)) {
        // Test-only app policy: these legacy routes remain session-only in
        // Zero itself, while an app can explicitly admit Guardian API keys.
        access.authorize({ credentials: ['session', 'api-key'] });
      }
    })
    .use(createStoragePlugin({
    db,
    adapter,
    studio: resolveStorageStudioConfig(studioEnabled ? {
      enabled: true,
      organizationDrives: true,
      personalDrives: true,
      personalSelfService: false,
      isolation: 'shared-cas',
      publicAccess: {
        allowPublicDrives: false,
        allowPublicObjects: false,
      },
    } : undefined),
    getTokenService: () => tokenService,
    studioLifecycleProvider: lifecycleProvider,
    onServiceCreated(created) {
      storage = created;
    },
    authorization,
  }));
  app.listen(0);
  const harness: Harness = {
    app,
    baseUrl: `http://localhost:${app.server!.port}`,
    db,
    storage,
    credentials,
  };
  active.push(harness);
  return harness;
}

class TestCredentialResolver implements AuthRequestCredentialResolver {
  private readonly liveByReference = new Map<string, AuthContext>();
  private readonly captureWaiters: Array<() => void> = [];
  private revokeOnCaptureId: string | null = null;

  constructor(private readonly contexts: ReadonlyMap<string, AuthContext>) {
    for (const context of contexts.values()) {
      this.liveByReference.set(referenceId(context), context);
    }
  }

  async resolve(request: Request): Promise<AuthContext | null> {
    const header = request.headers.get('authorization');
    const token = header?.match(/^Bearer\s+(.+)$/iu)?.[1];
    return token ? this.contexts.get(token) ?? null : null;
  }

  captureAuthority(context: AuthContext): AuthRequestAuthorityReference {
    this.captureWaiters.shift()?.();
    const id = referenceId(context);
    if (this.revokeOnCaptureId === id) {
      this.revokeOnCaptureId = null;
      this.liveByReference.delete(id);
    }
    return Object.freeze({
      kind: 'api-key' as const,
      version: 1 as const,
      keyId: referenceId(context),
      keyGeneration: 1,
      userId: context.userId,
      scopeKind: context.sessionScopeKind ?? 'application',
      scopeId: context.sessionScopeId ?? 'application',
    });
  }

  resolveAuthority(reference: AuthRequestAuthorityReference): AuthContext | null {
    const id = reference.kind === 'api-key'
      ? reference.keyId
      : reference.reference.sessionId;
    return this.liveByReference.get(id) ?? null;
  }

  waitForNextCapture(): Promise<void> {
    return new Promise((resolve) => { this.captureWaiters.push(resolve); });
  }

  revokeOnNextAuthorityCapture(credential: string): void {
    const context = this.contexts.get(credential);
    if (!context) throw new Error(`Unknown test credential: ${credential}`);
    this.revokeOnCaptureId = referenceId(context);
  }

  revoke(credential: string): void {
    const context = this.contexts.get(credential);
    if (context) this.liveByReference.delete(referenceId(context));
  }

  restore(credential: string): void {
    const context = this.contexts.get(credential);
    if (context) this.liveByReference.set(referenceId(context), context);
  }
}

function referenceId(context: AuthContext): string {
  return context.credentialId ?? context.sessionId ?? `actor-${context.userId}`;
}

async function withinOneSecond<T>(promise: Promise<T>, message: string): Promise<T> {
  return Promise.race([
    promise,
    Bun.sleep(1_000).then(() => { throw new Error(message); }),
  ]);
}

async function issueUploadCapability(
  harness: Harness,
  driveId: string,
  path: string,
): Promise<string> {
  const response = await json<{ token: string }>(
    harness,
    'POST',
    `/storage/drives/${driveId}/presign`,
    { path, method: 'upload' },
    'session-a',
  );
  expect(response.status).toBe(200);
  return response.body.token;
}

function installIdentityReferences(db: ReactiveDB): void {
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    INSERT INTO users (user_id) VALUES ('user-a'), ('viewer-a'), ('user-b');
    INSERT INTO _auth_tenant_memberships (membership_id)
      VALUES ('membership-a'), ('membership-viewer-a'), ('membership-b');
  `);
}

function requestContexts(): ReadonlyMap<string, AuthContext> {
  return new Map([
    ['session-a', tenantContext('user-a', 'membership-a', TENANT_A, 'session')],
    ['api-key-a', tenantContext('user-a', 'membership-a', TENANT_A, 'api-key')],
    ['viewer-a', tenantContext('viewer-a', 'membership-viewer-a', TENANT_A, 'session')],
    ['session-b', tenantContext('user-b', 'membership-b', TENANT_B, 'session')],
  ]);
}

function tenantContext(
  userId: string,
  membershipId: string,
  tenantId: string,
  credentialKind: 'session' | 'api-key',
): AuthContext {
  return Object.freeze({
    userId,
    email: `${userId}@example.test`,
    role: 'user',
    credentialKind,
    ...(credentialKind === 'api-key'
      ? { credentialId: `key-${userId}` }
      : { sessionKind: 'web' as const, sessionId: `session-${userId}` }),
    sessionScopeKind: 'tenant' as const,
    sessionScopeId: tenantId,
    tenantId,
    tenantKind: 'organization' as const,
    membershipId,
    tenantRole: 'member',
    tenantAuthorizationGeneration: 1,
    membershipAuthorizationGeneration: 1,
    authorizationAssignmentRevision: `assignment-${membershipId}`,
  });
}

function createRoleAssignments(): AuthorizationRoleAssignmentResolver {
  const roleByMembership = new Map([
    ['membership-a', ADMIN_ROLE],
    ['membership-viewer-a', VIEWER_ROLE],
    ['membership-b', ADMIN_ROLE],
  ]);
  return {
    resolveApplicationRoles() {
      return null;
    },
    resolveTenantRoles(input): AuthorizationRoleSet | null {
      const role = roleByMembership.get(input.membershipId);
      if (!role) return null;
      return Object.freeze({
        scopeKind: 'tenant' as const,
        scopeId: input.tenantId,
        tenantId: input.tenantId,
        membershipId: input.membershipId,
        userId: input.userId,
        roles: Object.freeze([role]),
        revision: `roles-${input.membershipId}`,
      });
    },
  };
}

function testAdapter(): StorageAdapter {
  return {
    writeShutdownSafety: 'cooperative',
    supportedStudioIsolation: ['shared-cas'],
    async writeBlob(data) {
      const bytes = data instanceof Uint8Array
        ? data
        : data instanceof Blob
          ? new Uint8Array(await data.arrayBuffer())
          : new Uint8Array(await new Response(data).arrayBuffer());
      return {
        checksum: new Bun.CryptoHasher('sha256').update(bytes).digest('hex'),
        size: bytes.length,
        headBytes: bytes.slice(0, 512),
      };
    },
    async readBlob() { return null; },
    async readBlobRange() { return null; },
    async removeBlob() {},
    removeBlobSync() {},
    async blobExists() { return true; },
    async blobSize() { return 0; },
  };
}

class BlockingStorageAdapter implements StorageAdapter {
  readonly writeShutdownSafety = 'cooperative' as const;
  readonly supportedStudioIsolation = ['shared-cas'] as const;
  private readonly blobs = new Map<string, Uint8Array>();
  private nextBarrier: {
    started(): void;
    wait: Promise<void>;
  } | null = null;

  blockNextWrite(): { started: Promise<void>; release(): void } {
    let started!: () => void;
    let release!: () => void;
    const startedPromise = new Promise<void>((resolve) => { started = resolve; });
    const wait = new Promise<void>((resolve) => { release = resolve; });
    this.nextBarrier = { started, wait };
    return { started: startedPromise, release };
  }

  async writeBlob(data: ReadableStream<Uint8Array> | Uint8Array | Blob) {
    const bytes = data instanceof Uint8Array
      ? data
      : data instanceof Blob
        ? new Uint8Array(await data.arrayBuffer())
        : new Uint8Array(await new Response(data).arrayBuffer());
    const checksum = new Bun.CryptoHasher('sha256').update(bytes).digest('hex');
    this.blobs.set(checksum, bytes);
    const barrier = this.nextBarrier;
    if (barrier) {
      this.nextBarrier = null;
      barrier.started();
      await barrier.wait;
    }
    return { checksum, size: bytes.length, headBytes: bytes.slice(0, 512) };
  }

  async readBlob(checksum: string) {
    const bytes = this.blobs.get(checksum);
    return bytes ? new Blob([Uint8Array.from(bytes).buffer]).stream() : null;
  }

  async readBlobRange(checksum: string, start: number, end: number) {
    const bytes = this.blobs.get(checksum);
    return bytes
      ? new Blob([Uint8Array.from(bytes.slice(start, end + 1)).buffer]).stream()
      : null;
  }

  async removeBlob(checksum: string) { this.blobs.delete(checksum); }
  removeBlobSync(checksum: string) { this.blobs.delete(checksum); }
  async blobExists(checksum: string) { return this.blobs.has(checksum); }
  async blobSize(checksum: string) { return this.blobs.get(checksum)?.length ?? 0; }
}

async function lifecycle(
  harness: Harness,
  driveId: string,
  credential: string,
  operationId: string,
  expectedRevision: number,
  action: 'suspend' | 'resume' | 'delete' | 'restore' | 'retry',
): Promise<HttpResult<StorageStudioMutationReceipt<StorageStudioDrive>>> {
  return json(harness, 'POST', `/storage/studio/drives/${driveId}/lifecycle`, {
    operationId,
    expectedRevision,
    action,
  }, credential);
}

async function json<T>(
  harness: Harness,
  method: string,
  path: string,
  body?: unknown,
  credential?: string,
): Promise<HttpResult<T>> {
  const headers = new Headers();
  if (body !== undefined) headers.set('content-type', 'application/json');
  if (credential) headers.set('authorization', `Bearer ${credential}`);
  const response = await fetch(`${harness.baseUrl}${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return {
    status: response.status,
    headers: response.headers,
    body: await response.json().catch(() => ({})) as T,
  };
}
