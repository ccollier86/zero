/**
 * storage-service.ts
 *
 * Storage domain service for drive metadata, object metadata, permission
 * checks, and blob reference bookkeeping. This file owns storage invariants
 * and persistence calls; HTTP routing and auth token verification live in the
 * plugin and auth layers.
 */

import type { ReactiveDB } from '../sync/reactive-db';
import type { Row } from '../sync/types';
import type {
  StorageAdapter,
  DriveRecord,
  ObjectRecord,
  BlobRecord,
  CreateDriveParams,
  FileInfo,
  UploadOptions,
  ListOptions,
  ListResult,
  DriveUsage,
  GrantPermissionParams,
  PermissionRecord,
  PermissionLevel,
} from './types';
import { detectMimeType } from './mime';

// ─── SQL Row Types ──────────────────────────────────────────────────────────

interface SumRow { total: number }
interface CountRow { count: number }

// ─── Storage Error ──────────────────────────────────────────────────────────

/**
 * Domain error used by storage routes to map service failures to HTTP status.
 */
export class StorageError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

export type StorageDriveUpdates = Partial<
  Pick<DriveRecord, 'name' | 'max_size_bytes' | 'max_file_size_bytes' | 'allowed_mime_types'>
>;

/** Canonical grouped API for storage drive metadata operations. */
export interface StorageDriveApi {
  /** Create a drive owned by `ownerId`. */
  create(ownerId: string, params: CreateDriveParams): DriveRecord;
  /** Read one drive by id. */
  get(driveId: string): DriveRecord | null;
  /** Update mutable drive settings. */
  update(driveId: string, updates: StorageDriveUpdates): DriveRecord;
  /** List all drives without user filtering. */
  list(): DriveRecord[];
  /** List drives visible to a concrete user/security context. */
  listForUser(userId: string, userRole: string | null, userProperties?: Record<string, string>): DriveRecord[];
  /** Delete a drive, its object metadata, and tracked blob references. */
  delete(driveId: string): boolean;
  /** Return aggregate usage for one drive. */
  usage(driveId: string): DriveUsage;
  /** Toggle drive-level public read visibility. */
  setVisibility(driveId: string, isPublic: boolean): DriveRecord;
}

/** Canonical grouped API for storage object and folder operations. */
export interface StorageObjectApi {
  /** Upload file bytes and create or overwrite object metadata. */
  upload(
    driveId: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    fileName: string,
    userId: string | null,
    options?: UploadOptions
  ): Promise<FileInfo>;
  /** Download a full file by drive/path. */
  download(driveId: string, path: string): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  /** Download a byte range for media/file streaming. */
  downloadRange(
    driveId: string,
    path: string,
    start: number,
    end: number
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null>;
  /** Read file or folder metadata by path. */
  get(driveId: string, path: string): FileInfo | null;
  /** List children under a folder path. */
  list(driveId: string, parentPath?: string, options?: ListOptions): ListResult;
  /** Move a file or folder to a new path. */
  move(driveId: string, fromPath: string, toPath: string): Promise<FileInfo>;
  /** Copy a file to a new path. */
  copy(driveId: string, fromPath: string, toPath: string): Promise<FileInfo>;
  /** Delete a file or folder subtree. */
  delete(driveId: string, path: string): Promise<boolean>;
  /** Create a folder and any missing parent folders. */
  createFolder(driveId: string, path: string, userId: string | null, isPublic?: boolean): FileInfo;
  /** Toggle object-level public read visibility. */
  setVisibility(driveId: string, path: string, isPublic: boolean): FileInfo;
}

/** Canonical grouped API for storage permission operations. */
export interface StoragePermissionApi {
  /** Grant drive or object access to a role, user, or user property. */
  grant(driveId: string, params: GrantPermissionParams): PermissionRecord;
  /** Read one permission by id. */
  get(permissionId: string): PermissionRecord | null;
  /** Revoke a permission by id. */
  revoke(permissionId: string): boolean;
  /** Check whether a concrete user/security context has enough access. */
  checkAccess(
    driveId: string,
    path: string | null,
    userId: string | null,
    userRole: string | null,
    userProperties: Record<string, string>,
    requiredLevel: PermissionLevel
  ): boolean;
}

// ─── Table Definitions ──────────────────────────────────────────────────────

/**
 * Define all storage tables on the shared ReactiveDB.
 * Called once during plugin onStart — idempotent.
 */
export function defineStorageTables(db: ReactiveDB): void {
  // Drives — reactive, broadcast to sync subscribers
  db.defineTable('storage_drives', {
    drive_id: 'text primary key',
    name: 'text not null',
    owner_id: 'text',
    max_size_bytes: 'integer not null default 0',
    max_file_size_bytes: 'integer not null default 0',
    allowed_mime_types: "text not null default '*'",
    public: 'integer not null default 0',
    created_at: 'integer not null',
  });

  // Objects (files + folders) — reactive
  db.defineTable('storage_objects', {
    object_id: 'text primary key',
    drive_id: 'text not null',
    parent_id: 'text',
    name: 'text not null',
    path: 'text not null',
    type: 'text not null',
    mime_type: 'text',
    size_bytes: 'integer not null default 0',
    checksum: 'text',
    public: 'integer not null default 0',
    metadata: "text not null default '{}'",
    created_by: 'text',
    created_at: 'integer not null',
    updated_at: 'integer not null',
  });

  // Blob reference tracking — internal, no broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _storage_blobs (
      checksum    TEXT PRIMARY KEY,
      size_bytes  INTEGER NOT NULL,
      ref_count   INTEGER NOT NULL DEFAULT 1,
      created_at  INTEGER NOT NULL
    )
  `);

  // Permissions — internal, no broadcast
  db.exec(`
    CREATE TABLE IF NOT EXISTS _storage_permissions (
      permission_id TEXT PRIMARY KEY,
      drive_id      TEXT NOT NULL,
      object_id     TEXT,
      grant_type    TEXT NOT NULL,
      grant_key     TEXT,
      grant_value   TEXT NOT NULL,
      permission    TEXT NOT NULL,
      created_at    INTEGER NOT NULL
    )
  `);
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_storage_perms_drive ON _storage_permissions(drive_id)'
  );
  db.exec(
    'CREATE UNIQUE INDEX IF NOT EXISTS idx_storage_objects_drive_path ON storage_objects(drive_id, path)'
  );
  db.exec(
    'CREATE INDEX IF NOT EXISTS idx_storage_objects_parent ON storage_objects(drive_id, parent_id)'
  );
}

// ─── StorageService ─────────────────────────────────────────────────────────

/**
 * Coordinate storage metadata, permissions, and blob adapter operations.
 *
 * The service accepts concrete user IDs, roles, and adapter inputs; it does
 * not depend on Elysia route context or transport details.
 */
export class StorageService {
  private stmts!: ReturnType<typeof this.prepareStatements>;

  /** Canonical grouped API for drive metadata. */
  readonly drives: StorageDriveApi = {
    create: (ownerId, params) => this.createDrive(ownerId, params),
    get: (driveId) => this.getDrive(driveId),
    update: (driveId, updates) => this.updateDrive(driveId, updates),
    list: () => this.listDrives(),
    listForUser: (userId, userRole, userProperties = {}) =>
      this.listDrivesForUser(userId, userRole, userProperties),
    delete: (driveId) => this.deleteDrive(driveId),
    usage: (driveId) => this.getDriveUsage(driveId),
    setVisibility: (driveId, isPublic) => this.setDriveVisibility(driveId, isPublic),
  };

  /** Canonical grouped API for files and folders. */
  readonly objects: StorageObjectApi = {
    upload: (driveId, path, data, fileName, userId, options = {}) =>
      this.upload(driveId, path, data, fileName, userId, options),
    download: (driveId, path) => this.download(driveId, path),
    downloadRange: (driveId, path, start, end) =>
      this.downloadRange(driveId, path, start, end),
    get: (driveId, path) => this.getFileInfo(driveId, path),
    list: (driveId, parentPath, options) => this.listFolder(driveId, parentPath, options),
    move: (driveId, fromPath, toPath) => this.moveObject(driveId, fromPath, toPath),
    copy: (driveId, fromPath, toPath) => this.copyObject(driveId, fromPath, toPath),
    delete: (driveId, path) => this.deleteObject(driveId, path),
    createFolder: (driveId, path, userId, isPublic = false) =>
      this.createFolder(driveId, path, userId, isPublic),
    setVisibility: (driveId, path, isPublic) => this.setVisibility(driveId, path, isPublic),
  };

  /** Canonical grouped API for storage grants and access checks. */
  readonly permissions: StoragePermissionApi = {
    grant: (driveId, params) => this.grantPermission(driveId, params),
    get: (permissionId) => this.getPermission(permissionId),
    revoke: (permissionId) => this.revokePermission(permissionId),
    checkAccess: (driveId, path, userId, userRole, userProperties, requiredLevel) =>
      this.checkAccess(driveId, path, userId, userRole, userProperties, requiredLevel),
  };

  constructor(
    private db: ReactiveDB,
    private adapter: StorageAdapter
  ) {
    this.stmts = this.prepareStatements();
  }

  private prepareStatements() {
    return {
      getDrive: this.db.prepare('SELECT * FROM storage_drives WHERE drive_id = ?'),
      listDrives: this.db.prepare('SELECT * FROM storage_drives ORDER BY name'),
      getObject: this.db.prepare('SELECT * FROM storage_objects WHERE object_id = ?'),
      getObjectByPath: this.db.prepare(
        'SELECT * FROM storage_objects WHERE drive_id = ? AND path = ?'
      ),
      listFolder: this.db.prepare(
        `SELECT * FROM storage_objects
         WHERE drive_id = ? AND parent_id IS ?
         ORDER BY type DESC, name ASC`
      ),
      listFolderPaged: this.db.prepare(
        `SELECT * FROM storage_objects
         WHERE drive_id = ? AND parent_id IS ?
         ORDER BY type DESC, name ASC
         LIMIT ? OFFSET ?`
      ),
      countFolder: this.db.prepare(
        'SELECT COUNT(*) as count FROM storage_objects WHERE drive_id = ? AND parent_id IS ?'
      ),
      getDriveUsage: this.db.prepare(
        "SELECT COALESCE(SUM(size_bytes), 0) as total FROM storage_objects WHERE drive_id = ? AND type = 'file'"
      ),
      getDriveFileCount: this.db.prepare(
        "SELECT COUNT(*) as count FROM storage_objects WHERE drive_id = ? AND type = 'file'"
      ),
      getDriveFolderCount: this.db.prepare(
        "SELECT COUNT(*) as count FROM storage_objects WHERE drive_id = ? AND type = 'folder'"
      ),
      getPermissions: this.db.prepare(
        'SELECT * FROM _storage_permissions WHERE drive_id = ? AND object_id IS NULL'
      ),
      getObjectPermissions: this.db.prepare(
        'SELECT * FROM _storage_permissions WHERE drive_id = ? AND (object_id IS NULL OR object_id = ?)'
      ),
      getAllDriveFiles: this.db.prepare(
        "SELECT * FROM storage_objects WHERE drive_id = ? AND type = 'file'"
      ),
      getAllDriveObjects: this.db.prepare(
        'SELECT * FROM storage_objects WHERE drive_id = ?'
      ),
      getChildFiles: this.db.prepare(
        "SELECT * FROM storage_objects WHERE drive_id = ? AND path LIKE ? AND type = 'file'"
      ),
      getAllChildren: this.db.prepare(
        'SELECT * FROM storage_objects WHERE drive_id = ? AND path LIKE ?'
      ),
      // Blob ref counting
      getBlob: this.db.prepare('SELECT * FROM _storage_blobs WHERE checksum = ?'),
      incrementBlobRef: this.db.prepare(
        'UPDATE _storage_blobs SET ref_count = ref_count + 1 WHERE checksum = ?'
      ),
      decrementBlobRef: this.db.prepare(
        'UPDATE _storage_blobs SET ref_count = ref_count - 1 WHERE checksum = ?'
      ),
      insertBlob: this.db.prepare(
        'INSERT OR IGNORE INTO _storage_blobs (checksum, size_bytes, ref_count, created_at) VALUES (?, ?, 1, ?)'
      ),
      deleteBlob: this.db.prepare('DELETE FROM _storage_blobs WHERE checksum = ?'),
      insertPermission: this.db.prepare(
        'INSERT INTO _storage_permissions (permission_id, drive_id, object_id, grant_type, grant_key, grant_value, permission, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ),
      deletePermission: this.db.prepare(
        'DELETE FROM _storage_permissions WHERE permission_id = ?'
      ),
      getPermissionById: this.db.prepare(
        'SELECT * FROM _storage_permissions WHERE permission_id = ?'
      ),
      deletePermissionsByDrive: this.db.prepare(
        'DELETE FROM _storage_permissions WHERE drive_id = ?'
      ),
    };
  }

  // ─── Drives ─────────────────────────────────────────────────────────────

  createDrive(ownerId: string, params: CreateDriveParams): DriveRecord {
    const driveId = `drv_${crypto.randomUUID()}`;
    const now = Date.now();

    const drive: DriveRecord = {
      drive_id: driveId,
      name: params.name,
      owner_id: ownerId,
      max_size_bytes: params.maxSize ?? 0,
      max_file_size_bytes: params.maxFileSize ?? 0,
      allowed_mime_types: params.allowedMimeTypes?.join(',') ?? '*',
      public: params.public ? 1 : 0,
      created_at: now,
    };

    this.db.insert('storage_drives', drive as unknown as Row);
    return drive;
  }

  getDrive(driveId: string): DriveRecord | null {
    return this.stmts.getDrive.get(driveId) as DriveRecord | null;
  }

  /**
   * Update drive settings while preserving fields omitted by the caller.
   */
  updateDrive(
    driveId: string,
    updates: StorageDriveUpdates
  ): DriveRecord {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    const sanitizedUpdates: Partial<Pick<
      DriveRecord,
      'name' | 'max_size_bytes' | 'max_file_size_bytes' | 'allowed_mime_types'
    >> = {};

    if (updates.name !== undefined) sanitizedUpdates.name = updates.name;
    if (updates.max_size_bytes !== undefined) {
      sanitizedUpdates.max_size_bytes = updates.max_size_bytes;
    }
    if (updates.max_file_size_bytes !== undefined) {
      sanitizedUpdates.max_file_size_bytes = updates.max_file_size_bytes;
    }
    if (updates.allowed_mime_types !== undefined) {
      sanitizedUpdates.allowed_mime_types = updates.allowed_mime_types;
    }

    const updated: DriveRecord = { ...drive, ...sanitizedUpdates };
    this.db.update('storage_drives', driveId, updated as unknown as Row);
    return updated;
  }

  listDrives(): DriveRecord[] {
    return this.stmts.listDrives.all() as DriveRecord[];
  }

  /**
   * List drives accessible by a user.
   * Checks ownership, public flag, and all permission grant types (user, role, property).
   */
  listDrivesForUser(
    userId: string,
    userRole: string | null,
    userProperties: Record<string, string> = {}
  ): DriveRecord[] {
    const allDrives = this.listDrives();
    return allDrives.filter(drive => {
      if (drive.public) return true;
      if (drive.owner_id === userId) return true;
      if (userRole === 'admin') return true;
      return this.checkAccess(
        drive.drive_id, null, userId, userRole, userProperties, 'read'
      );
    });
  }

  deleteDrive(driveId: string): boolean {
    const drive = this.getDrive(driveId);
    if (!drive) return false;

    // Get ALL files and ALL objects in one pass each — no double-counting
    const allFiles = this.stmts.getAllDriveFiles.all(driveId) as ObjectRecord[];
    const allObjects = this.stmts.getAllDriveObjects.all(driveId) as ObjectRecord[];

    this.db.transaction(() => {
      // Decrement blob refs for files only (once per file)
      for (const obj of allFiles) {
        if (obj.checksum) this.decrementBlobRef(obj.checksum);
      }
      // Delete all objects
      for (const obj of allObjects) {
        this.db.delete('storage_objects', obj.object_id);
      }
      // Delete permissions
      this.stmts.deletePermissionsByDrive.run(driveId);
      // Delete drive
      this.db.delete('storage_drives', driveId);
    });

    return true;
  }

  getDriveUsage(driveId: string): DriveUsage {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    const { total } = this.stmts.getDriveUsage.get(driveId) as SumRow;
    const { count: fileCount } = this.stmts.getDriveFileCount.get(driveId) as CountRow;
    const { count: folderCount } = this.stmts.getDriveFolderCount.get(driveId) as CountRow;

    return {
      driveId,
      name: drive.name,
      totalBytes: total,
      maxBytes: drive.max_size_bytes,
      fileCount,
      folderCount,
      percentUsed: drive.max_size_bytes > 0
        ? Math.round((total / drive.max_size_bytes) * 10000) / 100
        : 0,
    };
  }

  // ─── File Operations ────────────────────────────────────────────────────

  async upload(
    driveId: string,
    path: string,
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    fileName: string,
    userId: string | null,
    options: UploadOptions = {}
  ): Promise<FileInfo> {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    // Pass max file size to adapter so streaming rejects early
    const maxFileSize = drive.max_file_size_bytes > 0
      ? drive.max_file_size_bytes
      : undefined;

    // Write blob — adapter returns checksum, size, and head bytes for MIME detection
    const { checksum, size, headBytes } = await this.adapter.writeBlob(data, maxFileSize);

    // Detect MIME type from head bytes (no re-read needed)
    const detectedMime = detectMimeType(headBytes, fileName);

    // Validate drive capacity
    if (drive.max_size_bytes > 0) {
      const { total } = this.stmts.getDriveUsage.get(driveId) as SumRow;
      if (total + size > drive.max_size_bytes) {
        throw new StorageError(413,
          `Upload would exceed drive capacity (${total + size} > ${drive.max_size_bytes})`
        );
      }
    }

    // Validate MIME type
    if (drive.allowed_mime_types !== '*') {
      const allowed = drive.allowed_mime_types.split(',');
      if (!matchesMimeType(detectedMime, allowed)) {
        throw new StorageError(415,
          `MIME type '${detectedMime}' not allowed. Allowed: ${drive.allowed_mime_types}`
        );
      }
    }

    // Normalize path (safe against traversal)
    const normalizedPath = normalizePath(path);

    // Check if exists
    const existing = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (existing && !options.overwrite) {
      throw new StorageError(409,
        `File already exists: ${normalizedPath}. Use overwrite: true to replace.`
      );
    }

    // Ensure parent folders exist
    const parentId = this.ensureParentFolders(driveId, normalizedPath, userId);

    // Handle blob ref counting
    const existingBlob = this.stmts.getBlob.get(checksum) as BlobRecord | null;
    if (existingBlob) {
      // Blob already tracked — increment ref if this is a new file (not overwrite of same content)
      if (!existing || existing.checksum !== checksum) {
        this.stmts.incrementBlobRef.run(checksum);
      }
    } else {
      // New blob — insert tracking record
      this.stmts.insertBlob.run(checksum, size, Date.now());
    }

    // If overwriting, decrement old blob ref
    if (existing?.checksum && existing.checksum !== checksum) {
      this.decrementBlobRef(existing.checksum);
    }

    const now = Date.now();
    const objectId = existing?.object_id ?? `obj_${crypto.randomUUID()}`;
    const objectName = normalizedPath.split('/').pop()!;

    if (existing) {
      const updated: ObjectRecord = {
        ...existing,
        size_bytes: size,
        mime_type: detectedMime,
        checksum,
        metadata: JSON.stringify(options.metadata ?? JSON.parse(existing.metadata)),
        public: options.public !== undefined ? (options.public ? 1 : 0) : existing.public,
        updated_at: now,
      };
      this.db.update('storage_objects', objectId, updated as unknown as Row);
      return toFileInfo(updated);
    }

    const record: ObjectRecord = {
      object_id: objectId,
      drive_id: driveId,
      parent_id: parentId,
      name: objectName,
      path: normalizedPath,
      type: 'file',
      mime_type: detectedMime,
      size_bytes: size,
      checksum,
      public: options.public ? 1 : 0,
      metadata: JSON.stringify(options.metadata ?? {}),
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    this.db.insert('storage_objects', record as unknown as Row);
    return toFileInfo(record);
  }

  async download(
    driveId: string,
    path: string
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null> {
    const normalizedPath = normalizePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj || obj.type !== 'file' || !obj.checksum) return null;

    const stream = await this.adapter.readBlob(obj.checksum);
    if (!stream) return null;

    return { stream, info: toFileInfo(obj) };
  }

  async downloadRange(
    driveId: string,
    path: string,
    start: number,
    end: number
  ): Promise<{ stream: ReadableStream<Uint8Array>; info: FileInfo } | null> {
    const normalizedPath = normalizePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj || obj.type !== 'file' || !obj.checksum) return null;

    const stream = await this.adapter.readBlobRange(obj.checksum, start, end);
    if (!stream) return null;

    return { stream, info: toFileInfo(obj) };
  }

  getFileInfo(driveId: string, path: string): FileInfo | null {
    const normalizedPath = normalizePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj) return null;
    return toFileInfo(obj);
  }

  listFolder(driveId: string, parentPath?: string, options?: ListOptions): ListResult {
    const normalizedPath = parentPath ? normalizePath(parentPath) : null;
    let parentId: string | null = null;

    if (normalizedPath) {
      const parent = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
      if (!parent) return { items: [], cursor: null, total: 0 };
      parentId = parent.object_id;
    }

    const { count: total } = this.stmts.countFolder.get(driveId, parentId) as CountRow;
    const limit = options?.limit ?? 100;
    const offset = options?.cursor ? parseInt(options.cursor, 10) : 0;

    const rows = this.stmts.listFolderPaged.all(
      driveId, parentId, limit, offset
    ) as ObjectRecord[];

    const nextOffset = offset + rows.length;
    const cursor = nextOffset < total ? String(nextOffset) : null;

    return {
      items: rows.map(toFileInfo),
      cursor,
      total,
    };
  }

  async moveObject(driveId: string, fromPath: string, toPath: string): Promise<FileInfo> {
    const from = normalizePath(fromPath);
    const to = normalizePath(toPath);

    const obj = this.stmts.getObjectByPath.get(driveId, from) as ObjectRecord | null;
    if (!obj) throw new StorageError(404, `Not found: ${from}`);

    const existing = this.stmts.getObjectByPath.get(driveId, to) as ObjectRecord | null;
    if (existing) throw new StorageError(409, `Target already exists: ${to}`);

    const newParentId = this.ensureParentFolders(driveId, to, obj.created_by);
    const newName = to.split('/').pop()!;

    const updated: ObjectRecord = {
      ...obj,
      path: to,
      name: newName,
      parent_id: newParentId,
      updated_at: Date.now(),
    };
    this.db.update('storage_objects', obj.object_id, updated as unknown as Row);

    // If folder, update all children paths
    if (obj.type === 'folder') {
      this.updateChildPaths(driveId, from, to);
    }

    return toFileInfo(updated);
  }

  async copyObject(driveId: string, fromPath: string, toPath: string): Promise<FileInfo> {
    const from = normalizePath(fromPath);
    const to = normalizePath(toPath);

    const obj = this.stmts.getObjectByPath.get(driveId, from) as ObjectRecord | null;
    if (!obj || obj.type !== 'file') throw new StorageError(404, `Not found or not a file: ${from}`);

    const existing = this.stmts.getObjectByPath.get(driveId, to) as ObjectRecord | null;
    if (existing) throw new StorageError(409, `Target already exists: ${to}`);

    // Increment blob ref — same content, new metadata record
    if (obj.checksum) {
      this.stmts.incrementBlobRef.run(obj.checksum);
    }

    const parentId = this.ensureParentFolders(driveId, to, obj.created_by);
    const now = Date.now();

    const copy: ObjectRecord = {
      object_id: `obj_${crypto.randomUUID()}`,
      drive_id: driveId,
      parent_id: parentId,
      name: to.split('/').pop()!,
      path: to,
      type: 'file',
      mime_type: obj.mime_type,
      size_bytes: obj.size_bytes,
      checksum: obj.checksum,
      public: obj.public,
      metadata: obj.metadata,
      created_by: obj.created_by,
      created_at: now,
      updated_at: now,
    };

    this.db.insert('storage_objects', copy as unknown as Row);
    return toFileInfo(copy);
  }

  async deleteObject(driveId: string, path: string): Promise<boolean> {
    const normalizedPath = normalizePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj) return false;

    if (obj.type === 'folder') {
      const children = this.stmts.getChildFiles.all(
        driveId, `${normalizedPath}/%`
      ) as ObjectRecord[];
      const allChildren = this.stmts.getAllChildren.all(
        driveId, `${normalizedPath}/%`
      ) as ObjectRecord[];

      this.db.transaction(() => {
        for (const child of children) {
          if (child.checksum) this.decrementBlobRef(child.checksum);
        }
        for (const child of allChildren) {
          this.db.delete('storage_objects', child.object_id);
        }
        this.db.delete('storage_objects', obj.object_id);
      });
    } else {
      // Wrap file deletion in transaction for atomicity
      this.db.transaction(() => {
        if (obj.checksum) this.decrementBlobRef(obj.checksum);
        this.db.delete('storage_objects', obj.object_id);
      });
    }

    return true;
  }

  createFolder(
    driveId: string,
    path: string,
    userId: string | null,
    isPublic = false
  ): FileInfo {
    const normalizedPath = normalizePath(path);
    const existing = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (existing) {
      if (existing.type === 'folder') return toFileInfo(existing);
      throw new StorageError(409, `A file already exists at: ${normalizedPath}`);
    }

    const parentId = this.ensureParentFolders(driveId, normalizedPath, userId);
    const now = Date.now();
    const folderName = normalizedPath.split('/').pop()!;

    const record: ObjectRecord = {
      object_id: `obj_${crypto.randomUUID()}`,
      drive_id: driveId,
      parent_id: parentId,
      name: folderName,
      path: normalizedPath,
      type: 'folder',
      mime_type: null,
      size_bytes: 0,
      checksum: null,
      public: isPublic ? 1 : 0,
      metadata: '{}',
      created_by: userId,
      created_at: now,
      updated_at: now,
    };

    this.db.insert('storage_objects', record as unknown as Row);
    return toFileInfo(record);
  }

  // ─── Visibility ─────────────────────────────────────────────────────────

  setVisibility(driveId: string, path: string, isPublic: boolean): FileInfo {
    const normalizedPath = normalizePath(path);
    const obj = this.stmts.getObjectByPath.get(driveId, normalizedPath) as ObjectRecord | null;
    if (!obj) throw new StorageError(404, `Not found: ${normalizedPath}`);

    const updated: ObjectRecord = {
      ...obj,
      public: isPublic ? 1 : 0,
      updated_at: Date.now(),
    };
    this.db.update('storage_objects', obj.object_id, updated as unknown as Row);
    return toFileInfo(updated);
  }

  setDriveVisibility(driveId: string, isPublic: boolean): DriveRecord {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    const updated: DriveRecord = { ...drive, public: isPublic ? 1 : 0 };
    this.db.update('storage_drives', driveId, updated as unknown as Row);
    return updated;
  }

  // ─── Permissions ────────────────────────────────────────────────────────

  grantPermission(driveId: string, params: GrantPermissionParams): PermissionRecord {
    const drive = this.getDrive(driveId);
    if (!drive) throw new StorageError(404, `Drive not found: ${driveId}`);

    let objectId: string | null = null;
    if (params.objectPath) {
      const obj = this.stmts.getObjectByPath.get(
        driveId, normalizePath(params.objectPath)
      ) as ObjectRecord | null;
      if (!obj) throw new StorageError(404, `Object not found: ${params.objectPath}`);
      objectId = obj.object_id;
    }

    const permId = `perm_${crypto.randomUUID()}`;
    const now = Date.now();

    this.stmts.insertPermission.run(
      permId, driveId, objectId, params.grantType,
      params.grantKey ?? null, params.grantValue, params.permission, now
    );

    return {
      permission_id: permId,
      drive_id: driveId,
      object_id: objectId,
      grant_type: params.grantType,
      grant_key: params.grantKey ?? null,
      grant_value: params.grantValue,
      permission: params.permission,
      created_at: now,
    };
  }

  /** Get a permission by ID (for authorization checks before revoke). */
  getPermission(permissionId: string): PermissionRecord | null {
    return this.stmts.getPermissionById.get(permissionId) as PermissionRecord | null;
  }

  revokePermission(permissionId: string): boolean {
    this.stmts.deletePermission.run(permissionId);
    return true;
  }

  /**
   * Check if a user has the required permission level on a drive/object.
   *
   * Access is granted if ANY of these are true:
   * 1. User is a platform admin (full access to everything)
   * 2. Drive is public (for read access)
   * 3. Object is public (for read access)
   * 4. User is the drive owner
   * 5. User has a matching permission grant (role, user ID, or property)
   */
  checkAccess(
    driveId: string,
    path: string | null,
    userId: string | null,
    userRole: string | null,
    userProperties: Record<string, string>,
    requiredLevel: PermissionLevel
  ): boolean {
    const drive = this.getDrive(driveId);
    if (!drive) return false;

    // Platform admin → full access
    if (userRole === 'admin') return true;

    // Public drive → read access
    if (drive.public && requiredLevel === 'read') return true;

    // Must be authenticated for non-public access
    if (!userId) return false;

    // Drive owner → full access
    if (drive.owner_id === userId) return true;

    // Check object-level public flag
    if (path && requiredLevel === 'read') {
      const obj = this.stmts.getObjectByPath.get(driveId, normalizePath(path)) as ObjectRecord | null;
      if (obj?.public) return true;
    }

    // Check permission grants
    let permissions: PermissionRecord[];
    if (path) {
      const obj = this.stmts.getObjectByPath.get(driveId, normalizePath(path)) as ObjectRecord | null;
      permissions = this.stmts.getObjectPermissions.all(
        driveId, obj?.object_id ?? null
      ) as PermissionRecord[];
    } else {
      permissions = this.stmts.getPermissions.all(driveId) as PermissionRecord[];
    }

    const levelRank: Record<PermissionLevel, number> = { read: 1, write: 2, admin: 3 };
    const requiredRank = levelRank[requiredLevel];

    for (const perm of permissions) {
      const permRank = levelRank[perm.permission as PermissionLevel];
      if (permRank < requiredRank) continue;

      switch (perm.grant_type) {
        case 'user':
          if (perm.grant_value === userId) return true;
          break;
        case 'role':
          if (perm.grant_value === userRole) return true;
          break;
        case 'property':
          if (perm.grant_key && userProperties[perm.grant_key] === perm.grant_value) return true;
          break;
      }
    }

    return false;
  }

  // ─── Blob Ref Counting ─────────────────────────────────────────────────

  private decrementBlobRef(checksum: string): void {
    this.stmts.decrementBlobRef.run(checksum);
    const blob = this.stmts.getBlob.get(checksum) as BlobRecord | null;
    if (blob && blob.ref_count <= 0) {
      this.stmts.deleteBlob.run(checksum);
      // Async cleanup — fire and forget
      this.adapter.removeBlob(checksum).catch(() => {});
    }
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  private ensureParentFolders(
    driveId: string,
    filePath: string,
    userId: string | null
  ): string | null {
    const parts = filePath.split('/').filter(Boolean);
    if (parts.length <= 1) return null;

    let currentPath = '';
    let parentId: string | null = null;

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += '/' + parts[i];

      const existing = this.stmts.getObjectByPath.get(driveId, currentPath) as ObjectRecord | null;
      if (existing) {
        parentId = existing.object_id;
        continue;
      }

      const now = Date.now();
      const folderId = `obj_${crypto.randomUUID()}`;

      const folder: ObjectRecord = {
        object_id: folderId,
        drive_id: driveId,
        parent_id: parentId,
        name: parts[i],
        path: currentPath,
        type: 'folder',
        mime_type: null,
        size_bytes: 0,
        checksum: null,
        public: 0,
        metadata: '{}',
        created_by: userId,
        created_at: now,
        updated_at: now,
      };

      this.db.insert('storage_objects', folder as unknown as Row);
      parentId = folderId;
    }

    return parentId;
  }

  private updateChildPaths(driveId: string, oldPrefix: string, newPrefix: string): void {
    const children = this.stmts.getAllChildren.all(
      driveId, `${oldPrefix}/%`
    ) as ObjectRecord[];

    for (const child of children) {
      const newPath = newPrefix + child.path.slice(oldPrefix.length);
      const updated: ObjectRecord = { ...child, path: newPath, updated_at: Date.now() };
      this.db.update('storage_objects', child.object_id, updated as unknown as Row);
    }
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

/**
 * Normalize a file path safely. Resolves `.` and `..` segments
 * without allowing traversal above root.
 */
function normalizePath(path: string): string {
  const segments = path.split('/').filter(Boolean);
  const resolved: string[] = [];

  for (const seg of segments) {
    if (seg === '..') {
      resolved.pop(); // Go up — but can't escape root (pop on empty is noop)
    } else if (seg !== '.') {
      resolved.push(seg);
    }
  }

  return '/' + resolved.join('/');
}

function matchesMimeType(mime: string, allowed: string[]): boolean {
  for (const pattern of allowed) {
    if (pattern === '*') return true;
    if (pattern === mime) return true;
    if (pattern.endsWith('/*')) {
      const prefix = pattern.slice(0, -2);
      if (mime.startsWith(prefix + '/')) return true;
    }
  }
  return false;
}

function toFileInfo(record: ObjectRecord): FileInfo {
  return {
    id: record.object_id,
    driveId: record.drive_id,
    name: record.name,
    path: record.path,
    type: record.type as 'file' | 'folder',
    mimeType: record.mime_type,
    sizeBytes: record.size_bytes,
    checksum: record.checksum,
    isPublic: record.public === 1,
    metadata: JSON.parse(record.metadata || '{}'),
    createdBy: record.created_by,
    createdAt: record.created_at,
    updatedAt: record.updated_at,
  };
}
