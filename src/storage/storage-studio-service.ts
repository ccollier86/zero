/**
 * storage-studio-service.ts
 *
 * Provides the public, transport-neutral Storage Studio facade. Focused domain
 * services own catalog projection, provisioning, editing, and lifecycle work.
 */

import type { RequestAuthorizationAccess } from '../auth/authorization-access';
import type { ServiceDataScope } from '../auth/service-data-scope';
import type { StorageStudioAuthority } from './storage-studio-authority';
import { resolveStorageStudioAuthority } from './storage-studio-authority';
import { StorageStudioAudit } from './storage-studio-audit';
import { StorageStudioCatalog } from './storage-studio-catalog';
import { StorageStudioCleanupCoordinator } from './storage-studio-cleanup-coordinator';
import type { StorageStudioCommitFence } from './storage-studio-commit-fence';
import type {
  StorageStudioCapabilities,
  StorageStudioDrive,
  StorageStudioDriveListRequest,
  StorageStudioDrivePage,
  StorageStudioDriveUpdateRequest,
  StorageStudioJobPage,
  StorageStudioLifecycleRequest,
  StorageStudioMutationReceipt,
  StorageStudioProvisionRequest,
} from './storage-studio-contracts';
import { StorageStudioEditor } from './storage-studio-editor';
import { StorageStudioJobStore } from './storage-studio-job-store';
import { StorageStudioJobReader } from './storage-studio-job-reader';
import { StorageStudioLifecycleCoordinator } from './storage-studio-lifecycle';
import { StorageStudioMaintenanceWorker } from './storage-studio-maintenance-worker';
import type { StorageStudioOwnerChoice } from './storage-studio-ownership';
import { StorageStudioProvisioner } from './storage-studio-provisioner';
import { StorageStudioRecoveryCoordinator } from './storage-studio-recovery-coordinator';
import type { StorageStudioServiceOptions } from './storage-studio-service-options';
import { StorageStudioStore } from './storage-studio-store';

export type { StorageStudioServiceOptions } from './storage-studio-service-options';

/** Stable Storage Studio surface used by HTTP and server-only integrations. */
export class StorageStudioService {
  private readonly config: StorageStudioServiceOptions['config'];
  private readonly catalog: StorageStudioCatalog;
  private readonly provisioner: StorageStudioProvisioner;
  private readonly editor: StorageStudioEditor;
  private readonly lifecycle: StorageStudioLifecycleCoordinator;
  private readonly jobReader: StorageStudioJobReader;
  private readonly store: StorageStudioStore;
  private readonly jobs: StorageStudioJobStore;
  private readonly maintenance: StorageStudioMaintenanceWorker;

  constructor(options: StorageStudioServiceOptions) {
    this.config = options.config;
    const store = new StorageStudioStore(options.db);
    this.store = store;
    const audit = new StorageStudioAudit(options.audit);
    this.catalog = new StorageStudioCatalog({
      storage: options.storage,
      store,
      config: options.config,
      tenancyMode: options.tenancyMode,
    });
    this.provisioner = new StorageStudioProvisioner({
      db: options.db,
      storage: options.storage,
      store,
      catalog: this.catalog,
      audit,
      config: options.config,
      tenancyMode: options.tenancyMode,
      providerKey: options.providerKey ?? 'storage',
    });
    this.editor = new StorageStudioEditor({
      db: options.db,
      storage: options.storage,
      store,
      catalog: this.catalog,
      audit,
      config: options.config,
    });
    const jobs = new StorageStudioJobStore(options.db);
    this.jobs = jobs;
    this.jobReader = new StorageStudioJobReader(options.db);
    const cleanup = new StorageStudioCleanupCoordinator({
      db: options.db,
      storage: options.storage,
      store,
      jobs,
      audit,
      systemAudit: options.audit,
    });
    const recovery = new StorageStudioRecoveryCoordinator({
      db: options.db,
      provider: options.lifecycleProvider ?? sharedCasLifecycleProvider,
      store,
      jobs,
      catalog: this.catalog,
      audit,
      providerTimeoutMs: options.lifecycleProviderTimeoutMs,
    });
    this.lifecycle = new StorageStudioLifecycleCoordinator({
      db: options.db,
      store,
      jobs,
      catalog: this.catalog,
      cleanup,
      recovery,
      audit,
    });
    this.maintenance = new StorageStudioMaintenanceWorker({
      runNextCleanupJob: async () => {
        const provider = await this.lifecycle.runNextProviderJob();
        return provider === 'idle'
          ? this.lifecycle.runNextCleanupJob()
          : provider;
      },
      nextCleanupJobAt: () => minimumTime(
        this.jobs.nextActionAt('cleanup'),
        this.lifecycle.nextProviderJobAt(),
      ),
      retryBlobCleanup: () => options.storage.retryBlobCleanup(),
      pruneExpiredOperations: () => (
        this.store.pruneExpiredTerminalOperations(Date.now(), 100)
      ),
      pruneTerminalJobs: () => this.jobs.pruneDetachedTerminal(
        Math.max(0, Date.now() - STORAGE_STUDIO_TERMINAL_JOB_RETENTION_MS),
        100,
      ),
    });
    jobs.setQueueChangeListener(() => this.maintenance.wake());
  }

  /** Resolve live Guardian authority with this service's sealed Studio policy. */
  resolveAuthority(
    access: RequestAuthorizationAccess,
    scope: ServiceDataScope,
  ): StorageStudioAuthority {
    return resolveStorageStudioAuthority(access, scope, this.config);
  }

  capabilities(authority: StorageStudioAuthority): StorageStudioCapabilities {
    return this.catalog.capabilities(authority);
  }

  listDrives(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    request: StorageStudioDriveListRequest = {},
  ): StorageStudioDrivePage {
    return this.catalog.list(authority, userProperties, request);
  }

  getDrive(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
  ): StorageStudioDrive {
    return this.catalog.get(authority, userProperties, driveId);
  }

  getDriveByKey(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    key: string,
    owner: StorageStudioOwnerChoice = 'organization',
  ): StorageStudioDrive {
    return this.catalog.getByKey(authority, userProperties, key, owner);
  }

  provisionDrive(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    request: StorageStudioProvisionRequest,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    return this.provisioner.provision(authority, userProperties, request, commitFence);
  }

  updateDrive(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    request: StorageStudioDriveUpdateRequest,
    commitFence?: StorageStudioCommitFence,
  ): StorageStudioMutationReceipt<StorageStudioDrive> {
    return this.editor.update(authority, userProperties, driveId, request, commitFence);
  }

  changeDriveLifecycle(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    request: StorageStudioLifecycleRequest,
    commitFence?: StorageStudioCommitFence,
  ): Promise<StorageStudioMutationReceipt<StorageStudioDrive>> {
    return this.lifecycle.execute(
      authority,
      userProperties,
      driveId,
      request,
      commitFence,
    );
  }

  listDriveJobs(
    authority: StorageStudioAuthority,
    userProperties: Record<string, string>,
    driveId: string,
    input: { readonly cursor?: string; readonly limit?: number } = {},
  ): StorageStudioJobPage {
    // Scope and catalog visibility are established before querying private
    // system tables; no caller-provided tenant selector reaches the reader.
    this.catalog.get(authority, userProperties, driveId);
    return this.jobReader.listDriveJobs(driveId, input);
  }

  /** Run one due cleanup job during managed startup/background recovery. */
  runNextCleanupJob() {
    return this.lifecycle.runNextCleanupJob();
  }

  /** Start automatic recovery only after plugin composition is complete. */
  startMaintenance(): void {
    this.maintenance.start();
  }

  /** Wake maintenance after an external provider-cleanup signal. */
  wakeMaintenance(): void {
    this.maintenance.wake();
  }

  /** Stop scheduling and join the active bounded pass. */
  async stopMaintenance(): Promise<void> {
    this.jobs.setQueueChangeListener(null);
    this.lifecycle.stopProviderJobs();
    await this.maintenance.stop();
  }
}

const sharedCasLifecycleProvider = Object.freeze({
  retryProvisioning: async () => {},
  restoreDrive: async () => {},
});

function minimumTime(left: number | null, right: number | null): number | null {
  if (left === null) return right;
  if (right === null) return left;
  return Math.min(left, right);
}
const STORAGE_STUDIO_TERMINAL_JOB_RETENTION_MS = 30 * 24 * 60 * 60_000;
