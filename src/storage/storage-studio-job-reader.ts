/**
 * storage-studio-job-reader.ts
 *
 * Reads bounded, browser-safe lifecycle job history. Queue leasing and job
 * mutation remain exclusively in StorageStudioJobStore.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type {
  StorageStudioJobPage,
  StorageStudioJobView,
} from './storage-studio-contracts';
import { StorageDomainError } from './storage-domain-error';
import type { StorageStudioJobRecord } from './storage-studio-job-store';
import { STORAGE_JOBS_TABLE } from './storage-studio-schema';

interface JobCursor {
  readonly createdAt: number;
  readonly jobId: string;
}

/** Read-only job history projection. */
export class StorageStudioJobReader {
  constructor(private readonly db: ReactiveDB) {}

  listDriveJobs(
    driveId: string,
    input: { readonly cursor?: string; readonly limit?: number } = {},
  ): StorageStudioJobPage {
    const limit = Math.min(Math.max(input.limit ?? 25, 1), 100);
    const cursor = input.cursor ? decodeJobCursor(input.cursor) : null;
    const rows = cursor
      ? this.db.prepare(`
          SELECT * FROM ${STORAGE_JOBS_TABLE}
          WHERE drive_id = ?
            AND (created_at < ? OR (created_at = ? AND job_id < ?))
          ORDER BY created_at DESC, job_id DESC
          LIMIT ?
        `).all(driveId, cursor.createdAt, cursor.createdAt, cursor.jobId, limit + 1)
      : this.db.prepare(`
          SELECT * FROM ${STORAGE_JOBS_TABLE}
          WHERE drive_id = ?
          ORDER BY created_at DESC, job_id DESC
          LIMIT ?
        `).all(driveId, limit + 1);
    const records = rows as StorageStudioJobRecord[];
    const hasMore = records.length > limit;
    const pageRows = hasMore ? records.slice(0, limit) : records;
    const last = pageRows.at(-1);
    const items = pageRows.map(projectJob);
    return Object.freeze({
      items: Object.freeze(items),
      page: Object.freeze({
        limit,
        count: items.length,
        hasMore,
        nextCursor: hasMore && last
          ? encodeJobCursor(last.created_at, last.job_id)
          : null,
      }),
    });
  }
}

function projectJob(job: StorageStudioJobRecord): StorageStudioJobView {
  return Object.freeze({
    jobId: job.job_id,
    kind: job.job_kind,
    status: job.status,
    generation: job.generation,
    attemptCount: job.attempt_count,
    maxAttempts: job.max_attempts,
    availableAt: job.available_at,
    failureCode: job.failure_code,
    createdAt: job.created_at,
    updatedAt: job.updated_at,
    completedAt: job.completed_at,
  });
}

function encodeJobCursor(createdAt: number, jobId: string): string {
  return new TextEncoder()
    .encode(JSON.stringify([createdAt, jobId]))
    .toBase64({ alphabet: 'base64url', omitPadding: true });
}

function decodeJobCursor(cursor: string): JobCursor {
  try {
    if (!/^[A-Za-z0-9_-]{1,512}$/u.test(cursor)) throw new TypeError('invalid');
    const decoded = Uint8Array.fromBase64(cursor, { alphabet: 'base64url' });
    const value: unknown = JSON.parse(new TextDecoder().decode(decoded));
    if (!Array.isArray(value)
      || value.length !== 2
      || !Number.isSafeInteger(value[0])
      || value[0] < 0
      || typeof value[1] !== 'string'
      || value[1].length < 1
      || value[1].length > 200) throw new TypeError('invalid');
    return { createdAt: value[0], jobId: value[1] };
  } catch {
    throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Storage job cursor is invalid.');
  }
}
