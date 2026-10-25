/** Trusted system artifacts reuse Storage CAS leases, references, publication recovery and shutdown. */
import type { ReactiveDB } from '../sync/reactive-db';
import type { StorageAdapter, StorageBlobWriteResult } from './types';
import { StorageBlobLifecycle, storageBlobMutationKey } from './storage-blob-lifecycle';
import { StorageDomainError } from './storage-domain-error';
import type { StorageUploadOperationTracker } from './storage-upload-operation-tracker';

export interface PrivateStorageObject { readonly id: string; readonly checksum: string; readonly sizeBytes: number; readonly mimeType: string; readonly createdAt: number }
interface PrivateRow { id: string; checksum: string; size_bytes: number; mime_type: string; created_at: number }
const MAX_BYTES = 8 * 1024 * 1024 + 16384;

export class StoragePrivateObjects {
  private readonly read;
  constructor(private readonly db: ReactiveDB, private readonly adapter: StorageAdapter,
    private readonly blobs: StorageBlobLifecycle, private readonly uploads: StorageUploadOperationTracker,
    private readonly settle: (value: StorageBlobWriteResult) => void) {
    this.read = db.prepare('SELECT id,checksum,size_bytes,mime_type,created_at FROM _storage_private_objects WHERE namespace=? AND id=?');
  }
  /** Stable identity is reserved before I/O. A changed retry is a conflict, never an overwrite. */
  put(namespace: string, id: string, bytes: Uint8Array, mimeType: string, authorize: () => void = () => {}): Promise<PrivateStorageObject> {
    validateIdentity(namespace, id);
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > MAX_BYTES || typeof mimeType !== 'string' || mimeType.length > 200 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(mimeType)) {
      return Promise.reject(new StorageDomainError('STORAGE_INPUT_INVALID', 'Private artifact input is invalid.'));
    }
    const captured = bytes.slice();
    const checksum = new Bun.CryptoHasher('sha256').update(captured).digest('hex');
    return this.uploads.run(async operation => {
      let staged: StorageBlobWriteResult | undefined, published = false;
      try {
        operation.setProviderHandoffSafe(this.adapter.writeShutdownSafety === 'durable-publication');
        try { staged = await this.adapter.writeBlob(captured, MAX_BYTES, { signal: operation.signal }); }
        finally { operation.setProviderHandoffSafe(false); }
        operation.signal.throwIfAborted();
        if (staged.checksum !== checksum || staged.size !== captured.byteLength) throw new StorageDomainError('STORAGE_PROVIDER_UNAVAILABLE', 'Private artifact publication is invalid.');
        const value = await this.blobs.run([`private\0${namespace}\0${id}`, storageBlobMutationKey(staged.checksum)], async () => {
          if (!await this.adapter.blobExists(staged!.checksum)) throw new StorageDomainError('STORAGE_PROVIDER_UNAVAILABLE', 'Private artifact bytes are unavailable.');
          return this.db.transaction(() => {
            operation.signal.throwIfAborted(); authorize();
            const prior = this.row(namespace, id);
            if (prior) {
              if (prior.checksum !== staged!.checksum || prior.size_bytes !== staged!.size || prior.mime_type !== mimeType) throw new StorageDomainError('STORAGE_CONFLICT', 'Private artifact identity is already in use.');
              return project(prior);
            }
            const createdAt = Date.now(); this.blobs.incrementInTransaction(staged!.checksum, staged!.size);
            this.db.prepare('INSERT INTO _storage_private_objects(namespace,id,checksum,size_bytes,mime_type,created_at) VALUES(?,?,?,?,?,?)')
              .run(namespace, id, staged!.checksum, staged!.size, mimeType, createdAt);
            return Object.freeze({ id, checksum: staged!.checksum, sizeBytes: staged!.size, mimeType, createdAt });
          });
        });
        published = true; this.settle(staged); return value;
      } catch (error) {
        if (operation.isDetached()) throw error;
        if (staged && staged.checksum === checksum && !published) { await this.blobs.cleanupUnreferenced(staged.checksum, staged.size); this.settle(staged); }
        throw error;
      }
    });
  }
  /** Caller owns domain authorization. No signed public URL or generic drive grant is created. */
  async get(namespace: string, id: string, authorize: () => void): Promise<{ object: PrivateStorageObject; stream: ReadableStream<Uint8Array> } | null> {
    validateIdentity(namespace, id); authorize(); const row = this.row(namespace, id); if (!row) return null;
    const stream = await this.adapter.readBlob(row.checksum);
    try { authorize(); } catch (error) { await stream?.cancel().catch(() => {}); throw error; }
    const current = this.row(namespace, id);
    if (!stream || !current || current.checksum !== row.checksum) { await stream?.cancel().catch(() => {}); return null; }
    return { object: project(row), stream };
  }
  async delete(namespace: string, id: string, authorize: () => void = () => {}): Promise<boolean> {
    validateIdentity(namespace, id); authorize(); const row = this.row(namespace, id); if (!row) return false;
    return this.blobs.run([`private\0${namespace}\0${id}`, storageBlobMutationKey(row.checksum)], async () => this.db.transaction(() => {
      authorize(); const current = this.row(namespace, id); if (!current) return false;
      if (current.checksum !== row.checksum) throw new StorageDomainError('STORAGE_CONFLICT', 'Private artifact changed before cleanup.');
      this.db.prepare('DELETE FROM _storage_private_objects WHERE namespace=? AND id=?').run(namespace, id);
      this.blobs.decrementInTransaction(row.checksum); return true;
    }));
  }
  private row(namespace: string, id: string): PrivateRow | null {
    const row = this.read.get(namespace, id) as PrivateRow | null;
    if (row && (row.id !== id || typeof row.checksum !== 'string' || !/^[a-f0-9]{64}$/.test(row.checksum)
      || !Number.isSafeInteger(row.size_bytes) || row.size_bytes < 0 || row.size_bytes > MAX_BYTES
      || typeof row.mime_type !== 'string' || row.mime_type.length > 200 || !/^[a-z0-9.+-]+\/[a-z0-9.+-]+$/.test(row.mime_type)
      || !Number.isSafeInteger(row.created_at) || row.created_at < 0)) throw new StorageDomainError('STORAGE_PROVIDER_UNAVAILABLE', 'Private artifact metadata is invalid.');
    return row;
  }
}
function validateIdentity(namespace: string, id: string): void {
  if (!/^zero\.[a-z0-9.-]{1,100}$/.test(namespace) || !/^[A-Za-z0-9:_.-]{1,200}$/.test(id)) throw new StorageDomainError('STORAGE_INPUT_INVALID', 'Private artifact identity is invalid.');
}
function project(row: PrivateRow): PrivateStorageObject { return Object.freeze({ id: row.id, checksum: row.checksum, sizeBytes: row.size_bytes, mimeType: row.mime_type, createdAt: row.created_at }); }
