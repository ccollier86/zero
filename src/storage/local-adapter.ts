/**
 * local-adapter.ts
 *
 * Local filesystem byte adapter for storage blobs. This file owns streamed
 * staging, content hashing, and atomic content-addressed publication only;
 * storage metadata, permissions, and route behavior remain in the
 * service/plugin layer.
 */

import {
  existsSync,
  statSync,
  unlinkSync,
} from 'node:fs';
import {
  mkdir,
  open,
  rename,
  stat,
  unlink,
  type FileHandle,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import type {
  StorageAdapter,
  StorageAdapterOperationOptions,
  StorageBlobWriteResult,
} from './types';
import { StorageDomainError } from './storage-domain-error';
import {
  ensureDirectoryDurableSync,
  LocalPublicationJournal,
  syncDirectory,
  syncDirectorySync,
} from './storage-local-publication-journal';

const HEAD_BYTES_LIMIT = 512;
const TEMP_FILE_PREFIX = 'upload_';
const SHA256_CHECKSUM = /^[a-f0-9]{64}$/u;

/** Physical isolation contract implemented by the built-in local adapter. */
export const LOCAL_STORAGE_STUDIO_ISOLATION = Object.freeze(['shared-cas'] as const);

type LocalBlobInput =
  | ReadableStream<Uint8Array>
  | AsyncIterable<Uint8Array>
  | Uint8Array
  | Blob;

// ─── Content-Addressable Local Adapter ───────────────────────────────────

/**
 * Store files on the local filesystem using content-addressable storage.
 *
 * Layout: `{baseDir}/blobs/{aa}/{bb}/{aabbcc...rest}`
 *
 * Each adapter instance stages uploads in a uniquely owned runtime directory.
 * It never guesses that another runtime's temp file is abandoned. Completed
 * files are atomically renamed into the two-level SHA-256 shard layout.
 */
export class LocalStorageAdapter implements StorageAdapter {
  readonly supportedStudioIsolation = LOCAL_STORAGE_STUDIO_ISOLATION;
  readonly writeShutdownSafety = 'durable-publication' as const;

  private readonly blobDir: string;
  private readonly runtimeTmpDir: string;
  private readonly publications: LocalPublicationJournal;
  private stopped = false;

  /** Create an adapter rooted at `baseDir` without touching other runtimes' temp files. */
  constructor(baseDir: string = '.storage') {
    const resolvedBaseDir = resolve(baseDir);
    this.blobDir = join(resolvedBaseDir, 'blobs');
    this.publications = new LocalPublicationJournal(resolvedBaseDir);
    this.runtimeTmpDir = this.publications.runtimeTmpDir;
    ensureDirectoryDurableSync(this.blobDir);
  }

  /**
   * Stream bytes into a private staging file while calculating SHA-256.
   *
   * The source is never accumulated in memory. Only the first 512 bytes are
   * retained for MIME detection. Publication is atomic, and every failure
   * cleans up only the staging file created by this invocation.
   */
  async writeBlob(
    data: LocalBlobInput,
    maxSize?: number,
    options: StorageAdapterOperationOptions = {},
  ): Promise<StorageBlobWriteResult> {
    if (this.stopped) {
      throw new StorageDomainError(
        'STORAGE_NOT_READY',
        'Local storage adapter is stopped.',
        { retryable: true, outcome: 'not-started' },
      );
    }
    const tempPath = join(
      this.runtimeTmpDir,
      `${TEMP_FILE_PREFIX}${crypto.randomUUID()}`,
    );
    const hash = new Bun.CryptoHasher('sha256');
    const headBuffer = new Uint8Array(HEAD_BYTES_LIMIT);
    let headLength = 0;
    let size = 0;
    let stagedFile: FileHandle | null = null;
    let ownsTempFile = false;
    let publicationId: string | null = null;

    try {
      throwIfStorageOperationAborted(options.signal);
      await mkdir(this.runtimeTmpDir, { recursive: true });
      stagedFile = await open(tempPath, 'wx', 0o600);
      ownsTempFile = true;

      for await (const chunk of blobChunks(data, options.signal)) {
        throwIfStorageOperationAborted(options.signal);
        if (!(chunk instanceof Uint8Array)) {
          throw new TypeError('Storage blob sources must yield Uint8Array chunks.');
        }
        if (chunk.byteLength === 0) continue;

        const nextSize = size + chunk.byteLength;
        if (!Number.isSafeInteger(nextSize)) {
          throw new RangeError('Storage blob size exceeds the supported integer range.');
        }
        if (maxSize !== undefined && nextSize > maxSize) {
          throw new StorageDomainError(
            'STORAGE_LIMIT_EXCEEDED',
            'Storage upload exceeds the configured file-size limit.',
            { outcome: 'not-committed' },
          );
        }

        hash.update(chunk);
        if (headLength < HEAD_BYTES_LIMIT) {
          const remaining = HEAD_BYTES_LIMIT - headLength;
          const captured = chunk.subarray(0, Math.min(remaining, chunk.byteLength));
          headBuffer.set(captured, headLength);
          headLength += captured.byteLength;
        }

        await this.writeStagedChunk(stagedFile, chunk);
        size = nextSize;
      }

      await stagedFile.sync();
      await stagedFile.close();
      stagedFile = null;
      throwIfStorageOperationAborted(options.signal);

      const checksum = hash.digest('hex');
      const blobPath = this.blobPath(checksum);
      await this.ensureBlobShardDirectories(blobPath);
      publicationId = await this.publications.create(checksum, size);
      this.publications.assertOwned();
      throwIfStorageOperationAborted(options.signal);
      await this.publishStagedBlob(tempPath, blobPath, checksum, size);
      this.publications.assertOwned();
      throwIfStorageOperationAborted(options.signal);

      return {
        checksum,
        size,
        headBytes: headBuffer.slice(0, headLength),
        publicationId,
      };
    } catch (error) {
      let failure = error;
      try {
        this.publications.assertOwned();
      } catch (ownershipError) {
        failure = ownershipError;
      }
      const cleanupErrors: unknown[] = [];
      if (stagedFile) {
        try {
          await stagedFile.close();
        } catch (cleanupError) {
          cleanupErrors.push(cleanupError);
        }
      }
      if (ownsTempFile) {
        try {
          await unlink(tempPath);
        } catch (cleanupError) {
          if (!isNodeError(cleanupError, 'ENOENT')) cleanupErrors.push(cleanupError);
        }
      }

      if (cleanupErrors.length > 0) {
        throw new AggregateError(
          [error, ...cleanupErrors],
          'Storage blob write failed and its private staging file could not be fully cleaned up.',
          { cause: failure }
        );
      }
      throw failure;
    }
  }

  async readBlob(checksum: string): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.blobPath(checksum);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;
    return file.stream();
  }

  async readBlobRange(
    checksum: string,
    start: number,
    end: number
  ): Promise<ReadableStream<Uint8Array> | null> {
    const path = this.blobPath(checksum);
    const file = Bun.file(path);
    if (!(await file.exists())) return null;

    // Bun.file().slice() returns a Blob for the byte range without copying it.
    return file.slice(start, end + 1).stream();
  }

  async removeBlob(checksum: string): Promise<void> {
    this.removeBlobSync(checksum);
  }

  removeBlobSync(checksum: string): void {
    const path = this.blobPath(checksum);
    const parent = dirname(path);
    if (existsSync(path)) unlinkSync(path);
    // A failed directory fsync leaves the durable zero-reference row in
    // place. Retry the fsync even when the name is already absent.
    if (existsSync(parent)) this.syncRemovalDirectory(parent);
  }

  /** Synchronous unlink durability seam used by crash fault-injection tests. */
  protected syncRemovalDirectory(path: string): void {
    syncDirectorySync(path);
  }

  async blobExists(checksum: string): Promise<boolean> {
    return Bun.file(this.blobPath(checksum)).exists();
  }

  async blobSize(checksum: string): Promise<number> {
    const path = this.blobPath(checksum);
    try {
      return statSync(path).size;
    } catch {
      return 0;
    }
  }

  /** Remove only this runtime's private staging directory after service drain. */
  stop(): void {
    if (this.stopped) return;
    this.stopped = true;
    this.publications.stop();
  }

  listPendingBlobPublications(limit?: number) {
    return this.publications.list(limit);
  }

  settleBlobPublication(publicationId: string): void {
    this.publications.settle(publicationId);
  }

  /**
   * Append one chunk completely to the staging file.
   *
   * Kept protected so adapter regression tests can force a mid-stream write
   * failure without exposing filesystem fault injection through production
   * configuration.
   */
  protected async writeStagedChunk(file: FileHandle, chunk: Uint8Array): Promise<void> {
    let offset = 0;
    while (offset < chunk.byteLength) {
      const { bytesWritten } = await file.write(
        chunk,
        offset,
        chunk.byteLength - offset,
        null
      );
      if (bytesWritten <= 0) {
        throw new Error('Storage staging write made no forward progress.');
      }
      offset += bytesWritten;
    }
  }

  /**
   * Rename one completed staging file into the blob namespace.
   *
   * Only a destination-exists collision is eligible for deduplication, and
   * even then the existing destination must match the expected size and hash.
   * All other rename failures are propagated to the caller.
   */
  protected async publishStagedBlob(
    tempPath: string,
    blobPath: string,
    checksum: string,
    size: number
  ): Promise<void> {
    try {
      await this.renameStagedBlob(tempPath, blobPath);
      // The file itself was fsynced before rename. Persist the destination
      // directory entry before the service is allowed to commit SQLite
      // metadata that references these bytes.
      await this.syncDirectory(dirname(blobPath));
      await this.syncDirectory(this.runtimeTmpDir);
      return;
    } catch (error) {
      if (!isDestinationCollision(error)) throw error;
    }

    await assertBlobMatches(blobPath, checksum, size);
    await unlink(tempPath);
    await this.syncDirectory(this.runtimeTmpDir);
  }

  /** Atomic filesystem publication seam used by focused failure tests. */
  protected renameStagedBlob(tempPath: string, blobPath: string): Promise<void> {
    return rename(tempPath, blobPath);
  }

  /** Directory durability seam used by publication fault-injection tests. */
  protected async syncDirectory(path: string): Promise<void> {
    await syncDirectory(path);
  }

  private async ensureBlobShardDirectories(blobPath: string): Promise<void> {
    const secondShard = dirname(blobPath);
    const firstShard = dirname(secondShard);
    await createDirectory(firstShard);
    // Another replica can create a shard then crash before syncing its parent.
    // Every publisher completes this durability fence even after EEXIST.
    await this.syncDirectory(this.blobDir);
    await createDirectory(secondShard);
    await this.syncDirectory(firstShard);
  }

  /** Resolve a checksum to its two-level sharded filesystem path. */
  private blobPath(checksum: string): string {
    if (!SHA256_CHECKSUM.test(checksum)) {
      throw new TypeError('Storage blob checksum is invalid.');
    }
    return join(this.blobDir, checksum.slice(0, 2), checksum.slice(2, 4), checksum);
  }
}

// ─── Streaming helpers ──────────────────────────────────────────────

async function* blobChunks(
  data: LocalBlobInput,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  throwIfStorageOperationAborted(signal);
  if (data instanceof Uint8Array) {
    yield data;
    return;
  }
  if (data instanceof Blob) {
    yield* readableStreamChunks(data.stream(), signal);
    return;
  }
  if (isReadableStream(data)) {
    yield* readableStreamChunks(data, signal);
    return;
  }
  if (isAsyncIterable(data)) {
    yield* data;
    return;
  }
  throw new TypeError('Unsupported storage blob source.');
}

async function* readableStreamChunks(
  stream: ReadableStream<Uint8Array>,
  signal?: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const reader = stream.getReader();
  const abort = () => { void reader.cancel(signal?.reason).catch(() => undefined); };
  signal?.addEventListener('abort', abort, { once: true });
  let completed = false;
  try {
    while (true) {
      throwIfStorageOperationAborted(signal);
      const result = await reader.read();
      throwIfStorageOperationAborted(signal);
      if (result.done) {
        completed = true;
        return;
      }
      yield result.value;
    }
  } finally {
    signal?.removeEventListener('abort', abort);
    if (!completed) {
      try {
        await reader.cancel();
      } catch {
        // Source cancellation is best-effort after a more useful write/input error.
      }
    }
    reader.releaseLock();
  }
}

function throwIfStorageOperationAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof Error) throw signal.reason;
  throw new StorageDomainError(
    'STORAGE_NOT_READY',
    'Storage operation was cancelled during shutdown.',
    { retryable: true, outcome: 'not-committed' },
  );
}

function isReadableStream(value: unknown): value is ReadableStream<Uint8Array> {
  return typeof (value as { getReader?: unknown } | null)?.getReader === 'function';
}

function isAsyncIterable(value: unknown): value is AsyncIterable<Uint8Array> {
  return typeof (value as { [Symbol.asyncIterator]?: unknown } | null)?.[
    Symbol.asyncIterator
  ] === 'function';
}

async function assertBlobMatches(
  blobPath: string,
  checksum: string,
  expectedSize: number
): Promise<void> {
  const existing = await stat(blobPath);
  if (!existing.isFile() || existing.size !== expectedSize) {
    throw new Error(
      `Storage blob publication collided with invalid content at checksum ${checksum}.`
    );
  }

  const hash = new Bun.CryptoHasher('sha256');
  for await (const chunk of readableStreamChunks(Bun.file(blobPath).stream())) {
    hash.update(chunk);
  }
  if (hash.digest('hex') !== checksum) {
    throw new Error(
      `Storage blob publication collided with invalid content at checksum ${checksum}.`
    );
  }
}

function isDestinationCollision(error: unknown): boolean {
  return isNodeError(error, 'EEXIST') || isNodeError(error, 'ENOTEMPTY');
}

function isNodeError(error: unknown, code: string): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as Error & { code?: unknown }).code === code
  );
}

/**
 * Reclaim only directories whose same-host owner process is provably gone.
 * Missing/corrupt markers and other-host owners are retained fail-closed.
 */
async function createDirectory(path: string): Promise<boolean> {
  try {
    await mkdir(path, { recursive: false, mode: 0o700 });
    return true;
  } catch (cause) {
    if (isNodeError(cause, 'EEXIST')) return false;
    throw cause;
  }
}
