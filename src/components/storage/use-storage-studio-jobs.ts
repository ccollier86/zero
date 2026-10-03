'use client';

/**
 * use-storage-studio-jobs.ts
 *
 * Loads and projects bounded lifecycle-job history for the selected drive.
 * Queue management, leases, and lifecycle mutations remain server-owned.
 */

import * as React from 'react';
import type { StorageStudioJobView as StorageStudioJobRecord } from '../../storage/storage-studio-contracts';
import type { AuthorizationScopeBoundary } from '../../frontend/client/authorization-scope-hooks';
import type { StorageStudioSdkSurface } from '../../frontend/client/storage-studio-client';
import type { StorageStudioJobView } from './storage-management-controller';
import { reportStorageActionError } from './storage-observability';

export function useStorageStudioJobs(input: {
  readonly surface: StorageStudioSdkSurface | null;
  readonly boundary: AuthorizationScopeBoundary;
  readonly driveId: string | null;
  readonly enabled: boolean;
}) {
  const [jobs, setJobs] = React.useState<readonly StorageStudioJobView[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [error, setError] = React.useState<Error | null>(null);
  const requestKey = `${input.boundary.key}\0${input.driveId ?? ''}\0${input.enabled ? '1' : '0'}`;
  const [loadedRequestKey, setLoadedRequestKey] = React.useState<string | null>(null);
  const [refreshRevision, setRefreshRevision] = React.useState(0);
  const boundaryKeyRef = React.useRef(input.boundary.key);
  const boundaryReadyRef = React.useRef(input.boundary.ready);
  const requestKeyRef = React.useRef(requestKey);
  boundaryKeyRef.current = input.boundary.key;
  boundaryReadyRef.current = input.boundary.ready;
  requestKeyRef.current = requestKey;

  React.useEffect(() => {
    const controller = new AbortController();
    const capturedKey = input.boundary.key;
    const capturedRequestKey = requestKey;
    setLoadedRequestKey(capturedRequestKey);
    setJobs([]);
    setError(null);
    if (!input.enabled || !input.surface || !input.driveId || !input.boundary.ready) {
      setLoading(false);
      return () => controller.abort();
    }
    setLoading(true);
    input.surface.listDriveJobs(input.driveId, { limit: 100 }, { signal: controller.signal })
      .then((page) => {
        if (isCurrent()) setJobs(Object.freeze(page.items.map(projectJob)));
      })
      .catch((cause) => {
        if (!controller.signal.aborted && isCurrent()) {
          const normalized = reportStorageActionError('studioJobsLoad', cause);
          setError(normalized);
        }
      })
      .finally(() => {
        if (isCurrent()) setLoading(false);
      });
    return () => controller.abort();

    function isCurrent(): boolean {
      return !controller.signal.aborted
        && boundaryReadyRef.current
        && boundaryKeyRef.current === capturedKey
        && requestKeyRef.current === capturedRequestKey;
    }
  }, [
    input.boundary.key,
    input.boundary.ready,
    input.driveId,
    input.enabled,
    input.surface,
    requestKey,
    refreshRevision,
  ]);

  const visible = input.boundary.ready && loadedRequestKey === requestKey;
  return {
    jobs: visible ? jobs : Object.freeze([]),
    loading: visible ? loading : Boolean(input.enabled && input.driveId && input.boundary.ready),
    error: visible ? error : null,
    refresh: React.useCallback(() => {
      if (boundaryReadyRef.current) setRefreshRevision((value) => value + 1);
    }, []),
  };
}

function projectJob(job: StorageStudioJobRecord): StorageStudioJobView {
  const progress = job.status === 'succeeded'
    ? 100
    : job.status === 'queued'
      ? 0
      : Math.min(95, Math.round((job.attemptCount / job.maxAttempts) * 100));
  return Object.freeze({
    id: job.jobId,
    label: jobLabel(job.kind),
    status: job.status,
    progress,
    detail: job.failureCode
      ? `${job.failureCode} · attempt ${job.attemptCount}/${job.maxAttempts}`
      : `Attempt ${job.attemptCount}/${job.maxAttempts}`,
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
  });
}

function jobLabel(kind: StorageStudioJobRecord['kind']): string {
  if (kind === 'provision') return 'Provision drive';
  if (kind === 'delete') return 'Delete drive';
  if (kind === 'restore') return 'Restore drive';
  if (kind === 'transfer') return 'Transfer drive';
  if (kind === 'reconcile') return 'Reconcile drive';
  return 'Clean up storage';
}
