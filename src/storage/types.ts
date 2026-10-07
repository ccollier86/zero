import type { ClientTableDef } from '../schema/define-schema';
import type { AuthAuditService } from '../auth/auth-audit-service';
import type {
  ResolvedStorageStudioConfig,
  StorageStudioIsolation,
} from './storage-config';

// ─── Drive Types ──────────────────────────────────────────────────────────

export interface DriveRecord {
  drive_id: string;
  /** Null in single-tenant mode; tenant id for multi-tenant drives. */
  tenant_id: string | null;
  name: string;
  owner_id: string | null;
  max_size_bytes: number;
  max_file_size_bytes: number;
  allowed_mime_types: string;
  public: number;
  created_at: number;
}

export interface StorageAccessCapabilities {
  /** Highest effective permission for the current caller. */
  effectiveAccess: PermissionLevel | null;
  /** Caller can read metadata and objects. */
  canRead: boolean;
  /** Caller can create, update, move, copy, or delete objects. */
  canWrite: boolean;
  /** Caller can manage drive settings, visibility, and grants. */
  canAdmin: boolean;
  /** Caller owns the drive. */
  isOwner: boolean;
  /** Legacy single-mode platform-admin bypass is active for this request. */
  isPlatformAdmin: boolean;
  /** Drive or object is public for read access. */
  isPublic: boolean;
}

export interface DriveRecordWithAccess extends DriveRecord {
  /** Access resolved for the current request context. */
  access: StorageAccessCapabilities;
}

export interface CreateDriveParams {
  name: string;
  /** Max total drive size in bytes. 0 = unlimited. */
  maxSize?: number;
  /** Max individual file size in bytes. 0 = unlimited. */
  maxFileSize?: number;
  /** Allowed MIME types. Supports wildcards: 'image/*', 'application/pdf'. Default: '*' (all). */
  allowedMimeTypes?: string[];
  /** Make entire drive publicly accessible without auth. */
  public?: boolean;
}

// ─── Object Types (files + folders) ───────────────────────────────────────

export type ObjectType = 'file' | 'folder';

export interface ObjectRecord {
  object_id: string;
  /** Duplicated from the parent drive for direct row classification. */
  tenant_id: string | null;
  drive_id: string;
  parent_id: string | null;
  name: string;
  path: string;
  type: ObjectType;
  mime_type: string | null;
  size_bytes: number;
  checksum: string | null;
  public: number;
  metadata: string;
  created_by: string | null;
  created_at: number;
  updated_at: number;
}

export interface FileInfo {
  id: string;
  driveId: string;
  name: string;
  path: string;
  type: ObjectType;
  mimeType: string | null;
  sizeBytes: number;
  checksum: string | null;
  isPublic: boolean;
  metadata: Record<string, unknown>;
  createdBy: string | null;
  createdAt: number;
  updatedAt: number;
}

// ─── Blob Record (content-addressable dedup) ─────────────────────────────

export interface BlobRecord {
  checksum: string;
  size_bytes: number;
  ref_count: number;
  created_at: number;
}

/** Durable local/provider receipt for bytes published before metadata commit. */
export interface StoragePendingBlobPublication {
  readonly publicationId: string;
  readonly checksum: string;
  readonly size: number;
}

export interface StorageBlobWriteResult {
  readonly checksum: string;
  readonly size: number;
  readonly headBytes: Uint8Array;
  /** Opaque adapter receipt settled only after metadata or cleanup is durable. */
  readonly publicationId?: string;
}

// ─── Permissions ──────────────────────────────────────────────────────────

export type GrantType = 'role' | 'user' | 'property';
export type PermissionLevel = 'read' | 'write' | 'admin';

export interface PermissionRecord {
  permission_id: string;
  /** Duplicated from the parent drive for direct authorization checks. */
  tenant_id: string | null;
  drive_id: string;
  object_id: string | null;
  grant_type: GrantType;
  grant_key: string | null;
  grant_value: string;
  permission: PermissionLevel;
  created_at: number;
}

export interface ListPermissionsOptions {
  /** Include object-level permissions for this path instead of drive-level only. */
  objectPath?: string;
}

export interface GrantPermissionParams {
  /** Target: drive-level if no objectPath, or specific file/folder. */
  objectPath?: string;
  /** Grant to a role, specific user, or users with a property value. */
  grantType: GrantType;
  /** Property key (only for 'property' grant type). e.g., 'department' */
  grantKey?: string;
  /** Role name, user ID, or property value. e.g., 'admin', 'user_123', 'engineering' */
  grantValue: string;
  /** Permission level. */
  permission: PermissionLevel;
}

// ─── Upload/Download ──────────────────────────────────────────────────────

export interface UploadOptions {
  /** Overwrite existing file. Default: false (throws if exists). */
  overwrite?: boolean;
  /** Custom metadata to attach. */
  metadata?: Record<string, unknown>;
  /** Make file publicly accessible. */
  public?: boolean;
  /**
   * Declared body size used for concurrent managed-upload admission. Blob and
   * Uint8Array inputs infer this automatically; streaming callers should set it.
   */
  contentLength?: number;
  /** Optional caller/capability byte ceiling, combined with the drive limit. */
  maxSize?: number;
  /** Optional caller/capability MIME allowlist checked against detected bytes. */
  allowedMimeTypes?: string[];
}

export interface PresignedUrlOptions {
  /** Expiry in seconds. Default: 3600 (1 hour). */
  expiresIn?: number;
  /** 'upload' for PUT, 'download' for GET. Default: 'download'. */
  method?: 'upload' | 'download';
  /** Max file size for upload presigned URLs (bytes). */
  maxSize?: number;
  /** Required content type for upload presigned URLs. */
  contentType?: string;
}

// ─── Public Upload Grants ─────────────────────────────────────────────────

export interface StorageUploadGrantResource {
  /** Application resource type to link the upload to, e.g. `intake` or `appointment`. */
  type: string;
  /** Application resource id to link the upload to. */
  id: string;
}

export interface CreateUploadGrantParams {
  /** Exact storage path this grant can upload to. */
  path: string;
  /** Expiry in seconds. Defaults to the storage plugin TTL. */
  expiresIn?: number;
  /** Max uploaded bytes accepted by this grant. */
  maxSize?: number;
  /** Single accepted content type. Use `contentTypes` for multiple types. */
  contentType?: string;
  /** Accepted content types. Supports exact MIME types and `image/*` wildcards. */
  contentTypes?: string[];
  /** Allow replacing an existing object at `path`. Default: false. */
  overwrite?: boolean;
  /** Make the uploaded object publicly readable. Default: false. */
  public?: boolean;
  /** Metadata written to the storage object after upload. */
  metadata?: Record<string, unknown>;
  /** Application flow tag, e.g. `intake` or `profile-avatar`. */
  flow?: string;
  /** Optional app resource linkage copied into the token response. */
  resource?: StorageUploadGrantResource;
}

export interface StorageUploadGrant {
  /** Bearer capability used with `PUT /storage/upload-grants/:token`. */
  token: string;
  /** Stable grant id embedded in the token for audit/linkage. */
  grantId: string;
  /** Target drive. */
  driveId: string;
  /** Exact target object path. */
  path: string;
  /** Expiry window in seconds. */
  expiresIn: number;
  /** Absolute expiry timestamp in unix milliseconds. */
  expiresAt: number;
  /** Max uploaded bytes accepted by this grant. */
  maxSize?: number;
  /** Accepted request content types. */
  contentTypes?: string[];
  /** Whether this grant may overwrite an existing object. */
  overwrite: boolean;
  /** Whether the uploaded object will be publicly readable. */
  public: boolean;
  /** Metadata written to the uploaded object. */
  metadata?: Record<string, unknown>;
  /** Application flow tag. */
  flow?: string;
  /** Optional app resource linkage. */
  resource?: StorageUploadGrantResource;
}

export interface ListOptions {
  /** Only list files, folders, or both. Default: 'all'. */
  type?: 'file' | 'folder' | 'all';
  /** Case-insensitive literal substring matched against immediate-child name/path. */
  search?: string;
  /** Pagination cursor. */
  cursor?: string;
  /** Max items per page. Default: 100. */
  limit?: number;
  /** Sort by field. Default: 'name'. */
  sortBy?: 'name' | 'size' | 'created_at' | 'updated_at';
  /** Sort direction. Default: 'asc'. */
  sortDir?: 'asc' | 'desc';
}

export interface ListResult {
  items: FileInfo[];
  cursor: string | null;
  total: number;
}

// ─── Drive Usage ──────────────────────────────────────────────────────────

export interface DriveUsage {
  driveId: string;
  name: string;
  totalBytes: number;
  maxBytes: number;
  fileCount: number;
  folderCount: number;
  percentUsed: number;
}

// ─── Storage Adapter ──────────────────────────────────────────────────────

/**
 * Content-addressable byte storage adapter.
 *
 * Files are stored by SHA-256 checksum, enabling automatic deduplication.
 * The service layer handles metadata (SQLite) and ref counting.
 * The adapter handles reading/writing the actual bytes.
 */
export interface StorageAdapter {
  /**
   * Shutdown contract implemented by provider writes.
   *
   * `cooperative` means every write observes the supplied AbortSignal and
   * settles promptly. `durable-publication` additionally permits bounded
   * handoff because every published blob has a restart-recoverable receipt.
   */
  readonly writeShutdownSafety?: 'cooperative' | 'durable-publication';
  /**
   * Physical isolation contracts this adapter actually implements.
   *
   * Storage Studio fails closed when its configured isolation mode is absent
   * from this list. Legacy Storage remains compatible with adapters that omit
   * the declaration while Studio is disabled.
   */
  readonly supportedStudioIsolation?: readonly StorageStudioIsolation[];
  /** Write bytes, returning the SHA-256 checksum + head bytes for MIME detection. If blob already exists, returns checksum without rewriting. */
  writeBlob(
    data: ReadableStream<Uint8Array> | Uint8Array | Blob,
    maxSize?: number,
    options?: StorageAdapterOperationOptions,
  ): Promise<StorageBlobWriteResult>;
  /** Read blob by checksum. Returns null if not found. */
  readBlob(checksum: string): Promise<ReadableStream<Uint8Array> | null>;
  /** Read a byte range of a blob (for Range requests). */
  readBlobRange(checksum: string, start: number, end: number): Promise<ReadableStream<Uint8Array> | null>;
  /**
   * Legacy asynchronous deletion hook.
   *
   * It is retained for source compatibility, but the shared-CAS engine never
   * invokes it: an arbitrary awaited delete cannot be fenced against a second
   * runtime publishing a new reference after a lease expires. Adapters that
   * want automatic zero-reference cleanup must implement `removeBlobSync`.
   */
  removeBlob(checksum: string, options?: StorageAdapterOperationOptions): Promise<void>;
  /**
   * Synchronous deletion boundary used by shared-CAS Studio replicas. The
   * service invokes this while holding SQLite's writer lock, making lease
   * validation and physical deletion one non-yielding fenced operation.
   */
  removeBlobSync?(checksum: string): void;
  /** Check if a blob exists in storage. */
  blobExists(checksum: string): Promise<boolean>;
  /** Get the size of a blob on disk. Returns 0 if not found. */
  blobSize(checksum: string): Promise<number>;
  /** Bounded crash receipts awaiting metadata/reference reconciliation. */
  listPendingBlobPublications?(limit?: number): {
    readonly items: readonly StoragePendingBlobPublication[];
    readonly remaining: boolean;
  };
  /** Settle one opaque crash receipt after durable reference reconciliation. */
  settleBlobPublication?(publicationId: string): void;
  /** Release adapter-owned runtime resources after all service work drains. */
  stop?(): void | Promise<void>;
}

/** Cooperative cancellation supplied to provider I/O owned by Storage. */
export interface StorageAdapterOperationOptions {
  readonly signal?: AbortSignal;
}

// ─── Config ───────────────────────────────────────────────────────────────

export interface StoragePluginConfig {
  /** ReactiveDB instance (for metadata tables). */
  db: import('../sync/reactive-db').ReactiveDB;
  /** Storage adapter for byte storage. Default: local filesystem. */
  adapter?: StorageAdapter;
  /** Base directory for local file storage. Default: '.storage'. */
  localDir?: string;
  /**
   * Secret for signing presigned URLs and upload grants. When omitted, a
   * random 32-byte secret is generated once and retained in the system database.
   */
  signingSecret?: string;
  /** Default presigned URL expiry in seconds. Default: 3600. */
  defaultPresignedTTL?: number;
  /** Normalized, opt-in Storage Studio policy. Disabled when omitted. */
  studio?: ResolvedStorageStudioConfig;
  /** App-local runtime used by managed createApp() composition. */
  runtime?: import('../runtime/zero-app-runtime').ZeroAppRuntime;
  /** Explicit auth dependency; defaults to the legacy compatibility getter. */
  getTokenService?: () => import('../auth/token-service').TokenService | null;
  /** App-local kernel/property dependencies for request data scoping. */
  authorization?: import('../auth/auth.middleware').AuthMiddlewareAuthorizationOptions;
  /** Resolve authorization properties for one user in this app. */
  getUserProperties?: (userId: string) => Record<string, string>;
  /** Validate property keys admitted into storage authorization policy. */
  isPolicyTrustedProperty?: (key: string) => boolean;
  /** Resolve Guardian's app-local append-only audit service. */
  getAuditService?: () => AuthAuditService | null;
  /** Advanced idempotent hooks for an external Storage lifecycle provider. */
  studioLifecycleProvider?: import('./storage-studio-recovery-coordinator').StorageStudioLifecycleProvider;
  /** Deadline for one external lifecycle-provider continuation. */
  studioLifecycleProviderTimeoutMs?: number;
  /** Composition callback for app factories and advanced integrations. */
  onServiceCreated?: (service: import('./storage-service').StorageService) => void;
  /** Trusted composition hook. A verified grant's business receipt must remain live through publication. */
  captureUploadGrantCommitFence?: (grant: Readonly<import('./upload-grant').VerifiedUploadGrant>) => (() => void) | undefined;
}

// ─── Client Table Definitions ─────────────────────────────────────────────

/**
 * Spread into your client's `tables` config to sync storage metadata.
 *
 * @example
 * ```ts
 * createClient({
 *   url: 'http://localhost:3000',
 *   tables: { ...STORAGE_TABLES, ...myTables },
 * });
 * ```
 */
export const STORAGE_TABLES: Record<string, ClientTableDef> = {
  storage_drives: {
    _pk: 'drive_id',
    _sync: 'lazy',
    drive_id: 'text',
    tenant_id: 'text',
    name: 'text',
    owner_id: 'text',
    max_size_bytes: 'integer',
    max_file_size_bytes: 'integer',
    allowed_mime_types: 'text',
    public: 'integer',
    created_at: 'integer',
  },
  storage_objects: {
    _pk: 'object_id',
    _sync: 'lazy',
    object_id: 'text',
    tenant_id: 'text',
    drive_id: 'text',
    parent_id: 'text',
    name: 'text',
    path: 'text',
    type: 'text',
    mime_type: 'text',
    size_bytes: 'integer',
    checksum: 'text',
    public: 'integer',
    metadata: 'text',
    created_by: 'text',
    created_at: 'integer',
    updated_at: 'integer',
  },
};
