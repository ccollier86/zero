import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { AppendAuthAuditEventInput, AuthAuditEvent } from '../auth/auth-audit-types';
import { applicationServiceDataScope } from '../auth/service-data-scope';
import { createReactiveDB, type ReactiveDB } from '../sync/reactive-db';
import { StorageDomainError } from './storage-domain-error';
import { StorageStudioAudit } from './storage-studio-audit';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { StorageStudioCleanupCoordinator } from './storage-studio-cleanup-coordinator';
import type { StorageStudioDrive } from './storage-studio-contracts';
import {
  StorageStudioLifecycleCoordinator,
  type StorageStudioLifecycleProvider,
} from './storage-studio-lifecycle';
import { StorageStudioJobStore } from './storage-studio-job-store';
import { StorageStudioRecoveryCoordinator } from './storage-studio-recovery-coordinator';
import {
  defineStorageStudioTables,
  type StorageStudioDriveLifecycle,
  type StorageStudioDriveProfile,
} from './storage-studio-schema';
import { StorageStudioStore } from './storage-studio-store';

let db: ReactiveDB;

beforeEach(() => {
  db = createReactiveDB({ mode: 'memory' });
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE users (user_id TEXT PRIMARY KEY);
    CREATE TABLE _auth_tenant_memberships (membership_id TEXT PRIMARY KEY);
    CREATE TABLE storage_drives (drive_id TEXT PRIMARY KEY);
    INSERT INTO users (user_id) VALUES ('user_one');
  `);
  defineStorageStudioTables(db);
});

afterEach(() => db.dispose());

describe('Storage Studio lifecycle coordinator', () => {
  test('suspends and resumes with optimistic, idempotent capability revocation', async () => {
    const harness = createHarness('ready');
    const suspended = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('suspend', 'suspend-one', 1),
    );
    expect(suspended.value.profile).toMatchObject({
      lifecycle: 'suspended',
      revision: 2,
      generation: 2,
    });

    const replay = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('suspend', 'suspend-one', 1),
    );
    expect(replay.replayed).toBe(true);
    expect(harness.store.getProfile(DRIVE_ID)?.revision).toBe(2);

    await expect(harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('suspend', 'suspend-one', 2),
    )).rejects.toMatchObject({ code: 'STORAGE_IDEMPOTENCY_CONFLICT' });

    const resumed = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('resume', 'resume-one', 2),
    );
    expect(resumed.value.profile).toMatchObject({
      lifecycle: 'ready',
      revision: 3,
      generation: 2,
    });
    expect(harness.audit.events.map((event) => event.action)).toEqual([
      'storage.drive-suspended',
      'storage.drive-resumed',
    ]);
  });

  test('rejects stale revisions, invalid transitions, and missing control authority', async () => {
    const harness = createHarness('ready');
    await expect(harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('suspend', 'stale', 99),
    )).rejects.toMatchObject({ code: 'STORAGE_REVISION_CONFLICT' });
    await expect(harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('restore', 'invalid-restore', 1),
    )).rejects.toMatchObject({ code: 'STORAGE_CONFLICT' });
    await expect(harness.lifecycle.execute(
      { ...AUTHORITY, canManage: false, canDelete: false },
      {},
      DRIVE_ID,
      request('suspend', 'denied', 1),
    )).rejects.toMatchObject({ code: 'STORAGE_AUTHORITY_REQUIRED' });
    expect(harness.store.getProfile(DRIVE_ID)?.revision).toBe(1);
  });

  test('deletes through a retryable cleanup job and retains a restorable tombstone', async () => {
    let restoredProfile: StorageStudioDriveProfile | null = null;
    const harness = createHarness('ready', {
      restoreDrive: ({ profile }) => { restoredProfile = profile; },
    });
    const deleted = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('delete', 'delete-one', 1),
    );
    expect(harness.purgeCalls).toEqual([DRIVE_ID]);
    expect(deleted.value.profile).toMatchObject({
      driveId: DRIVE_ID,
      key: 'artifacts',
      lifecycle: 'deleted',
      revision: 3,
      generation: 2,
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM storage_drives').get())
      .toEqual({ count: 1 });

    const restored = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('restore', 'restore-one', 3),
    );
    expect(restoredProfile).toMatchObject({ lifecycle: 'restoring', revision: 4 });
    expect(restored.value.profile).toMatchObject({
      driveId: DRIVE_ID,
      key: 'artifacts',
      lifecycle: 'ready',
      revision: 5,
      generation: 3,
    });
    expect(harness.audit.events.map((event) => event.action)).toEqual([
      'storage.drive-delete-requested',
      'storage.drive-deleted',
      'storage.drive-restore-requested',
      'storage.drive-restored',
    ]);
    expect(harness.audit.events.map((event) => event.provenance)).toEqual([
      'request',
      'system',
      'request',
      'system',
    ]);
  });

  test('keeps a failed cleanup durable and finishes it through background recovery', async () => {
    const harness = createHarness('ready', {
      purgeOutcomes: [new Error('provider unavailable'), true],
    });
    const accepted = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('delete', 'delete-retry', 1),
    );
    expect(accepted.value.profile.lifecycle).toBe('deleting');
    expect(harness.store.getProfile(DRIVE_ID)).toMatchObject({
      lifecycle: 'deleting',
      revision: 2,
      generation: 2,
      failure_code: null,
    });
    expect(operation(harness.store, 'delete', 'delete-retry')?.status).toBe('pending');

    harness.advance(2_000);
    expect(await harness.lifecycle.runNextCleanupJob()).toBe('succeeded');
    expect(harness.store.getProfile(DRIVE_ID)).toMatchObject({
      lifecycle: 'deleted',
      revision: 3,
      generation: 2,
    });
    expect(operation(harness.store, 'delete', 'delete-retry')?.status).toBe('succeeded');
    expect(harness.audit.events.at(-1)).toMatchObject({
      action: 'storage.drive-deleted',
      provenance: 'system',
      actorUserId: 'user_one',
    });

    const replay = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('delete', 'delete-retry', 1),
    );
    expect(replay.replayed).toBe(true);
  });

  test('supports explicit cleanup retry after the durable attempt budget is exhausted', async () => {
    const harness = createHarness('ready', {
      purgeOutcomes: [
        new Error('one'),
        new Error('two'),
        new Error('three'),
        new Error('four'),
        new Error('five'),
        true,
      ],
    });
    const accepted = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('delete', 'delete-terminal', 1),
    );
    expect(accepted.value.profile.lifecycle).toBe('deleting');
    for (let attempt = 2; attempt <= 5; attempt += 1) {
      harness.advance(5 * 60_000);
      const result = await harness.lifecycle.runNextCleanupJob();
      expect(result).toBe(attempt === 5 ? 'failed' : 'retrying');
    }
    expect(harness.store.getProfile(DRIVE_ID)).toMatchObject({
      lifecycle: 'deleting',
      revision: 3,
      generation: 2,
      failure_code: 'STORAGE_PROVIDER_UNAVAILABLE',
    });
    expect(operation(harness.store, 'delete', 'delete-terminal')?.status).toBe('failed');

    const retried = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('retry', 'cleanup-retry', 3),
    );
    expect(retried.value.profile).toMatchObject({
      lifecycle: 'deleted',
      revision: 5,
      generation: 2,
    });
    expect(operation(harness.store, 'reconcile', 'cleanup-retry')?.status).toBe('succeeded');
  });

  test('reconciles failed provisioning through an explicit idempotent provider hook', async () => {
    let retriedProfile: StorageStudioDriveProfile | null = null;
    const harness = createHarness('failed', {
      retryProvisioning: ({ profile }) => { retriedProfile = profile; },
    });
    const recovered = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('retry', 'provision-retry', 1),
    );
    expect(retriedProfile).toMatchObject({ lifecycle: 'provisioning', revision: 2 });
    expect(recovered.value.profile).toMatchObject({
      lifecycle: 'ready',
      revision: 3,
      generation: 2,
      failureCode: null,
    });
  });

  test('records a known provider retry failure without publishing readiness', async () => {
    const harness = createHarness('failed', {
      retryProvisioning: () => {
        throw new StorageDomainError(
          'STORAGE_PROVIDER_UNAVAILABLE',
          'Provider rejected retry.',
          { retryable: false, outcome: 'not-committed' },
        );
      },
    });
    await expect(harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('retry', 'provider-failed', 1),
    )).rejects.toMatchObject({ code: 'STORAGE_PROVIDER_UNAVAILABLE' });
    expect(harness.store.getProfile(DRIVE_ID)).toMatchObject({
      lifecycle: 'failed',
      revision: 3,
      generation: 2,
      failure_code: 'STORAGE_PROVIDER_UNAVAILABLE',
    });
    expect(operation(harness.store, 'reconcile', 'provider-failed')?.status).toBe('failed');
  });

  test('marks committed provider failures ambiguous instead of rolling lifecycle backward', async () => {
    const harness = createHarness('failed', {
      retryProvisioning() {
        throw new StorageDomainError(
          'STORAGE_PROVIDER_UNAVAILABLE',
          'Provider completed externally but response delivery failed.',
          { outcome: 'committed', retryable: false },
        );
      },
    });
    await expect(harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('retry', 'provider-committed', 1),
    )).rejects.toMatchObject({
      code: 'STORAGE_OPERATION_OUTCOME_UNKNOWN',
      outcome: 'unknown',
    });
    expect(harness.store.getProfile(DRIVE_ID)).toMatchObject({
      lifecycle: 'degraded',
      failure_code: 'STORAGE_PROVIDER_UNAVAILABLE',
    });
    expect(operation(harness.store, 'reconcile', 'provider-committed')).toMatchObject({
      status: 'outcome_unknown',
    });
  });

  test('finishes system-owned restore but withholds private response after caller revocation', async () => {
    let entered!: () => void;
    let release!: () => void;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const providerRelease = new Promise<void>((resolve) => { release = resolve; });
    const harness = createHarness('deleted', {
      async restoreDrive() {
        entered();
        await providerRelease;
      },
    });
    let revoked = false;
    const lifecycle = harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('restore', 'restore-revoked', 1),
      () => {
        if (revoked) throw new Error('forced authority revocation');
      },
    );
    await providerEntered;
    revoked = true;
    release();

    await expect(lifecycle).rejects.toMatchObject({
      code: 'STORAGE_AUTHORITY_CHANGED',
      outcome: 'committed',
    });
    expect(harness.store.getProfile(DRIVE_ID)).toMatchObject({
      lifecycle: 'ready',
      revision: 3,
      generation: 2,
      failure_code: null,
    });
    expect(operation(harness.store, 'restore', 'restore-revoked')).toMatchObject({
      status: 'succeeded',
      error_code: null,
    });
  });

  test('leases provider continuation once across competing runtime coordinators', async () => {
    let entered!: () => void;
    let release!: () => void;
    let calls = 0;
    const providerEntered = new Promise<void>((resolve) => { entered = resolve; });
    const providerRelease = new Promise<void>((resolve) => { release = resolve; });
    const harness = createHarness('deleted', {
      async restoreDrive() {
        calls += 1;
        entered();
        await providerRelease;
      },
    });
    const first = harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('restore', 'cross-runtime-restore', 1),
    );
    await providerEntered;
    const pending = operation(harness.store, 'restore', 'cross-runtime-restore')!;
    const competing = new StorageStudioRecoveryCoordinator({
      db,
      provider: harness.provider,
      store: harness.store,
      jobs: new StorageStudioJobStore(db, 'competing-runtime'),
      catalog: harness.catalog,
      audit: harness.audit,
      now: harness.now,
    });

    expect(await competing.finishRestore(AUTHORITY, pending)).toBe('retrying');
    expect(calls).toBe(1);
    release();
    await first;
    expect(calls).toBe(1);
    expect(operation(harness.store, 'restore', 'cross-runtime-restore')?.status)
      .toBe('succeeded');
  });

  test('recovers a queued provider continuation after coordinator restart', async () => {
    let calls = 0;
    const harness = createHarness('failed', {
      retryProvisioning() {
        calls += 1;
        throw new StorageDomainError(
          'STORAGE_PROVIDER_UNAVAILABLE',
          'Provider safely rejected before commit.',
          { retryable: true, outcome: 'not-committed' },
        );
      },
    });
    const accepted = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('retry', 'restart-reconcile', 1),
    );
    expect(accepted.value.profile.lifecycle).toBe('provisioning');
    expect(calls).toBe(1);
    harness.advance(2_000);

    const restarted = new StorageStudioRecoveryCoordinator({
      db,
      provider: {
        retryProvisioning() { calls += 1; },
        restoreDrive() {},
      },
      store: harness.store,
      jobs: new StorageStudioJobStore(db, 'restarted-runtime'),
      catalog: harness.catalog,
      audit: harness.audit,
      now: harness.now,
    });
    expect(await restarted.runNext()).toBe('succeeded');
    expect(calls).toBe(2);
    expect(harness.store.getProfile(DRIVE_ID)?.lifecycle).toBe('ready');
    expect(operation(harness.store, 'reconcile', 'restart-reconcile')?.status)
      .toBe('succeeded');
  });

  test('bounds a non-settling provider call without automatically duplicating it', async () => {
    let aborted = false;
    const harness = createHarness('deleted', {
      providerTimeoutMs: 10,
      restoreDrive: ({ signal }) => new Promise<void>(() => {
        signal.addEventListener('abort', () => { aborted = true; }, { once: true });
      }),
    });

    const accepted = await Promise.race([
      harness.lifecycle.execute(
        AUTHORITY,
        {},
        DRIVE_ID,
        request('restore', 'provider-timeout', 1),
      ),
      Bun.sleep(1_000).then(() => { throw new Error('provider timeout did not settle'); }),
    ]);
    expect(accepted.value.profile.lifecycle).toBe('restoring');
    expect(aborted).toBe(true);
    const pending = operation(harness.store, 'restore', 'provider-timeout')!;
    expect(harness.jobs.getByOperation(pending.operation_id, 'restore')).toMatchObject({
      status: 'running',
    });
    harness.advance(31_000);
    expect(await harness.lifecycle.runNextProviderJob()).toBe('retrying');
    expect(operation(harness.store, 'restore', 'provider-timeout')).toMatchObject({
      status: 'outcome_unknown',
    });
    expect(harness.store.getProfile(DRIVE_ID)?.lifecycle).toBe('degraded');
  });

  test('hands a stopped provider lease back only after cancellation acknowledgement', async () => {
    let entered!: () => void;
    let continuationRole: string | null = null;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const harness = createHarness('deleted', {
      restoreDrive({ authority, signal }) {
        continuationRole = authority.actor.role;
        entered();
        return new Promise<void>((resolve) => {
          signal.addEventListener('abort', () => resolve(), { once: true });
        });
      },
    });
    const requestRun = harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('restore', 'provider-stop', 1),
    );
    await started;
    harness.lifecycle.stopProviderJobs();
    const accepted = await Promise.race([
      requestRun,
      Bun.sleep(1_000).then(() => { throw new Error('provider stop did not hand off'); }),
    ]);
    expect(accepted.value.profile.lifecycle).toBe('restoring');
    expect(String(continuationRole)).toBe('system-continuation');

    const restarted = new StorageStudioRecoveryCoordinator({
      db,
      provider: { retryProvisioning() {}, restoreDrive() {} },
      store: harness.store,
      jobs: new StorageStudioJobStore(db, 'takeover-runtime'),
      catalog: harness.catalog,
      audit: harness.audit,
      now: harness.now,
    });
    expect(await restarted.runNext()).toBe('succeeded');
    expect(harness.store.getProfile(DRIVE_ID)?.lifecycle).toBe('ready');
  });

  test('continues bounded cleanup batches without consuming retry budget', async () => {
    const harness = createHarness('ready', {
      purgeOutcomes: ['remaining', true],
    });
    const accepted = await harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('delete', 'bounded-delete', 1),
    );
    expect(accepted.value.profile.lifecycle).toBe('deleting');
    const job = harness.jobs.getByOperation(
      operation(harness.store, 'delete', 'bounded-delete')!.operation_id,
      'cleanup',
    )!;
    expect(job).toMatchObject({ status: 'queued', attempt_count: 0 });
    expect(await harness.lifecycle.runNextCleanupJob()).toBe('succeeded');
    expect(harness.store.getProfile(DRIVE_ID)?.lifecycle).toBe('deleted');
  });

  test('renews cleanup ownership while a bounded purge batch is in flight', async () => {
    let started!: () => void;
    let release!: () => void;
    const purgeStarted = new Promise<void>((resolve) => { started = resolve; });
    const purgeRelease = new Promise<void>((resolve) => { release = resolve; });
    const harness = createHarness('ready', {
      clock: Date.now,
      cleanupLeaseMs: 300,
      cleanupRenewIntervalMs: 5,
      purgeDriveContentsBatch: async (_driveId, _limit, authorizeCommit, signal) => {
        started();
        await purgeRelease;
        if (signal?.aborted) throw signal.reason;
        authorizeCommit?.();
        return { exists: true, remaining: false };
      },
    });

    const deleting = harness.lifecycle.execute(
      AUTHORITY,
      {},
      DRIVE_ID,
      request('delete', 'renewed-delete', 1),
    );
    await purgeStarted;
    const operationRecord = operation(harness.store, 'delete', 'renewed-delete')!;
    const initialJob = harness.jobs.getByOperation(operationRecord.operation_id, 'cleanup')!;
    const initialLeaseExpiry = initialJob.lease_expires_at!;
    await waitForCondition(() => (
      (harness.jobs.get(initialJob.job_id)?.lease_expires_at ?? 0) > initialLeaseExpiry
    ));
    const competitor = new StorageStudioJobStore(db, 'competing-cleanup-worker');
    expect(competitor.claim(initialJob.job_id, initialLeaseExpiry, 300)).toBeNull();

    release();
    await expect(deleting).resolves.toMatchObject({
      value: { profile: { lifecycle: 'deleted' } },
    });
  });
});

async function waitForCondition(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 1_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error('Storage lease was not renewed in time.');
    await Bun.sleep(5);
  }
}

const DRIVE_ID = 'drive_lifecycle';
const AUTHORITY: StorageStudioAuthority = Object.freeze({
  actor: Object.freeze({
    userId: 'user_one',
    email: 'user@example.test',
    role: 'admin',
    sessionId: 'session_one',
    sessionKind: 'web',
    sessionScopeKind: 'application',
    sessionScopeId: 'application',
  }),
  scope: applicationServiceDataScope(),
  dataRoles: Object.freeze(['admin']),
  canReadCatalog: true,
  canProvisionOrganization: true,
  canProvisionPersonal: false,
  canManage: true,
  canDelete: true,
  ownerChoices: Object.freeze(['organization'] as const),
});

interface HarnessOptions extends Partial<StorageStudioLifecycleProvider> {
  purgeOutcomes?: Array<true | false | 'remaining' | Error>;
  providerTimeoutMs?: number;
  clock?: () => number;
  cleanupLeaseMs?: number;
  cleanupRenewIntervalMs?: number;
  purgeDriveContentsBatch?: (
    driveId: string,
    limit?: number,
    authorizeCommit?: () => void,
    signal?: AbortSignal,
  ) => Promise<{ readonly exists: boolean; readonly remaining: boolean }>;
}

function createHarness(
  lifecycle: StorageStudioDriveLifecycle,
  options: HarnessOptions = {},
) {
  db.prepare('INSERT INTO storage_drives (drive_id) VALUES (?)').run(DRIVE_ID);
  const store = new StorageStudioStore(db);
  store.insertProfile(profileFixture(lifecycle));
  const jobs = new StorageStudioJobStore(db, `test-worker-${crypto.randomUUID()}`);
  const audit = new RecordingStorageStudioAudit();
  const systemAuditEvents: AppendAuthAuditEventInput[] = [];
  const systemAudit = {
    append(input: AppendAuthAuditEventInput): AuthAuditEvent {
      systemAuditEvents.push(input);
      return {} as AuthAuditEvent;
    },
  };
  let now = 1_000;
  const clock = options.clock ?? (() => now);
  const purgeOutcomes = [...(options.purgeOutcomes ?? [true])];
  const purgeCalls: string[] = [];
  const storage = options.purgeDriveContentsBatch ? {
    purgeDriveContentsBatch: options.purgeDriveContentsBatch,
  } : {
    async purgeDriveContentsBatch(driveId: string) {
      purgeCalls.push(driveId);
      const outcome = purgeOutcomes.shift() ?? true;
      if (outcome instanceof Error) throw outcome;
      return {
        exists: outcome !== false,
        remaining: outcome === 'remaining',
      };
    },
  };
  const catalog = createCatalog(store);
  const cleanup = new StorageStudioCleanupCoordinator({
    db,
    storage,
    store,
    jobs,
    audit,
    systemAudit,
    now: clock,
    emitCode: () => undefined,
    leaseMs: options.cleanupLeaseMs,
    renewIntervalMs: options.cleanupRenewIntervalMs,
  });
  const provider = {
    retryProvisioning: options.retryProvisioning ?? (() => {}),
    restoreDrive: options.restoreDrive ?? (() => {}),
  };
  const recovery = new StorageStudioRecoveryCoordinator({
    db,
    provider,
    store,
    jobs,
    catalog,
    audit,
    now: clock,
    providerTimeoutMs: options.providerTimeoutMs,
  });
  const coordinator = new StorageStudioLifecycleCoordinator({
    db,
    store,
    jobs,
    catalog,
    cleanup,
    recovery,
    audit,
    now: clock,
  });
  return {
    lifecycle: coordinator,
    store,
    audit,
    catalog,
    jobs,
    provider,
    recovery,
    now: clock,
    systemAuditEvents,
    purgeCalls,
    advance(milliseconds: number) { now += milliseconds; },
  };
}

function createCatalog(store: StorageStudioStore) {
  return {
    requireProfile(_authority: StorageStudioAuthority, driveId: string) {
      const profile = store.getProfile(driveId);
      if (!profile) throw new Error('missing profile');
      return profile;
    },
    get(_authority: StorageStudioAuthority, _properties: Record<string, string>, driveId: string) {
      const profile = store.getProfile(driveId)!;
      return projectDrive(profile);
    },
  };
}

function projectDrive(profile: StorageStudioDriveProfile): StorageStudioDrive {
  return {
    drive: {
      drive_id: profile.drive_id,
      tenant_id: null,
      name: 'Artifacts',
      owner_id: null,
      max_size_bytes: 1_000,
      max_file_size_bytes: 100,
      allowed_mime_types: '*',
      public: 0,
      created_at: profile.created_at,
      access: {
        effectiveAccess: null,
        canRead: false,
        canWrite: false,
        canAdmin: false,
        isOwner: false,
        isPlatformAdmin: true,
        isPublic: false,
      },
    },
    profile: {
      driveId: profile.drive_id,
      key: profile.drive_key,
      ownerKind: profile.owner_kind,
      ownerId: profile.owner_id,
      scopeKind: profile.scope_kind,
      lifecycle: profile.lifecycle,
      revision: profile.revision,
      isolation: profile.isolation_mode,
      generation: profile.generation,
      createdAt: profile.created_at,
      updatedAt: profile.updated_at,
      readyAt: profile.ready_at,
      degradedAt: profile.degraded_at,
      suspendedAt: profile.suspended_at,
      deletingAt: profile.deleting_at,
      deletedAt: profile.deleted_at,
      restoringAt: profile.restoring_at,
      failedAt: profile.failed_at,
      failureCode: profile.failure_code,
    },
    control: {
      canManage: true,
      canDelete: true,
      canSuspend: profile.lifecycle === 'ready',
      canRestore: profile.lifecycle === 'suspended' || profile.lifecycle === 'deleted',
    },
  };
}

function profileFixture(lifecycle: StorageStudioDriveLifecycle): StorageStudioDriveProfile {
  return {
    drive_id: DRIVE_ID,
    drive_key: 'artifacts',
    owner_kind: 'application',
    owner_id: 'application',
    scope_kind: 'application',
    scope_id: 'application',
    lifecycle,
    revision: 1,
    provider: 'local',
    provider_namespace: 'namespace_lifecycle',
    isolation_mode: 'shared-cas',
    generation: 1,
    created_by_user_id: 'user_one',
    created_by_membership_id: null,
    updated_by_user_id: 'user_one',
    updated_by_membership_id: null,
    created_at: 100,
    updated_at: 100,
    ready_at: lifecycle === 'ready' ? 100 : null,
    degraded_at: lifecycle === 'degraded' ? 100 : null,
    suspended_at: lifecycle === 'suspended' ? 100 : null,
    deleting_at: lifecycle === 'deleting' ? 100 : null,
    deleted_at: lifecycle === 'deleted' ? 100 : null,
    restoring_at: lifecycle === 'restoring' ? 100 : null,
    failed_at: lifecycle === 'failed' ? 100 : null,
    failure_code: lifecycle === 'failed' || lifecycle === 'degraded'
      ? 'STORAGE_PROVIDER_UNAVAILABLE'
      : null,
  };
}

function request(
  action: 'suspend' | 'resume' | 'delete' | 'restore' | 'retry',
  operationId: string,
  expectedRevision: number,
) {
  return { action, operationId, expectedRevision } as const;
}

function operation(
  store: StorageStudioStore,
  kind: 'delete' | 'restore' | 'reconcile',
  idempotencyKey: string,
) {
  return store.getOperation('application', 'application', 'user_one', kind, idempotencyKey);
}

interface RecordedAuditEvent {
  action: string;
  outcome: 'succeeded' | 'failed';
  driveId: string | null;
  provenance: 'request' | 'system';
  actorUserId: string;
}

class RecordingStorageStudioAudit extends StorageStudioAudit {
  readonly events: RecordedAuditEvent[] = [];

  constructor() {
    super(null);
  }

  override append(
    authority: StorageStudioAuthority,
    action: string,
    outcome: 'succeeded' | 'failed',
    driveId: string | null,
  ): void {
    this.events.push({
      action,
      outcome,
      driveId,
      provenance: 'request',
      actorUserId: authority.actor.userId,
    });
  }

  override appendContinuation(
    authority: StorageStudioAuthority,
    action: string,
    outcome: 'succeeded' | 'failed',
    driveId: string | null,
  ): void {
    this.events.push({
      action,
      outcome,
      driveId,
      provenance: 'system',
      actorUserId: authority.actor.userId,
    });
  }
}
